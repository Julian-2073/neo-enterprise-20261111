import asyncio,json
from copy import deepcopy
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.operating_reviews import grounded_review
from neo_agent.contracts import Job
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from neo_agent.runner import run_once


def basis(industry='ecommerce'):
 return {'generationId':'g','profileVersion':'p','profile':{'industry':industry,'region':'CN','competitors':[]},'asOf':'2026-09-30','period':{'start':'2026-09-01','end':'2026-09-30'},'metrics':{'paidOrders':{'value':20,'status':'complete','unit':'笔','evidenceIds':['fact-a']},'contributionMarginCents':{'value':None,'status':'partial','unit':'人民币分','evidenceIds':['fact-b']}},'quality':{'status':'partial','gaps':['成本待确认']}}

def answer():
 return {'headline':'成交有记录，成本待确认','explanation':'先核对履约成本，再判断经营收益。','claims':[{'metricKey':'paidOrders','value':20}],'evidenceIds':['metric:paidOrders'],'confirmations':[{'question':'成本是否完整','impact':'会改变收益判断','method':'与供应方对账'}],'nextAction':{'title':'核对成本资料','reason':'当前资料不足以比较收益','condition':'费用与履约成本完整后再比较'},'limitations':['没有对照实验，不能判断因果'],'selectedSourceIds':[]}

@pytest.mark.parametrize('industry',['hotel','ecommerce','manufacturing'])
def test_grounding_industry_and_unknown_values(industry):
 assert grounded_review(answer(),basis(industry),[])['claims'][0]['value']==20
 for change in [lambda x:x['claims'][0].update(value=21),lambda x:x['claims'][0].update(metricKey='contributionMarginCents',value=0),lambda x:x.update(evidenceIds=['other-company']),lambda x:x.update(selectedSourceIds=['unread']),lambda x:x.update(explanation='赚了200元')]:
  invalid=answer();change(invalid)
  with pytest.raises(ValueError):grounded_review(invalid,basis(industry),[])

class Model:
 name='isolated-test-model'
 def __init__(self):self.calls=0;self.interaction_seen=False
 async def call(self,messages,tools=None):
  self.calls+=1
  from semantic_model_stub import semantic_response
  checked=semantic_response(messages)
  if checked:return checked,{'total_tokens':50}
  assert '后台指标是唯一计算来源' in messages[0]['content']
  payload=json.loads(messages[1]['content'])
  if payload['basis'].get('interaction'):
   assert '追问不能覆盖事实' in messages[0]['content']
   assert payload['basis']['interaction']['question']=='优先核实哪项成本'
   self.interaction_seen=True
  if self.calls==4:assert 'completedSpecialists' in messages[1]['content'] and 'conversion' in messages[1]['content']
  return {'role':'assistant','content':json.dumps(answer(),ensure_ascii=False)},{'total_tokens':50}

def test_durable_operating_job_four_grounded_reviews_and_no_call_after_completion(tmp_path):
 async def exercise():
  q=JobQueue(tmp_path/'jobs.sqlite');q.initialize();model=Model()
  j=Job.model_validate({'id':'operating-test','businessId':'isolated-a','dataNature':'demo','snapshotId':'g','sessionId':'s','mode':'joint','purpose':'operating','question':'审查经营','envelope':{'snapshot':{'id':'g','businessId':'isolated-a','dataNature':'demo','asOf':'2026-09-30'},'operatingBasis':{**basis(),'interaction':{'question':'优先核实哪项成本','role':'joint','priorQuestion':'成本是否完整'}}},'budget':{'maxModelCalls':5,'maxMarketSearches':0,'maxTokens':60000}}).model_dump(mode='json')
  q.submit(j,source_hash(j))
  async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'checkpoints')) as saver:
   assert await run_once(q,'worker',saver,model_factory=lambda:model)
   result=q.observe(j['id']);assert result['status']=='completed',result
   assert set(result['result']['operatingReviews'])=={'conversion','supply','market','joint'}
   assert result['result']['generationId']=='g' and model.calls==5
   assert not await run_once(q,'worker',saver,model_factory=lambda:model)
   assert model.calls==5 and model.interaction_seen
  with q.db() as c:assert c.execute("SELECT COUNT(*) FROM model_calls WHERE state='completed'").fetchone()[0]==5
 asyncio.run(exercise())


def test_chinese_quantities_rejected_and_exact_claim_provenance_bound_by_server():
 for text in ['库存只有一件','本期有一笔订单','销量有两件']:
  invalid=answer();invalid['explanation']=text
  with pytest.raises(ValueError):grounded_review(invalid,basis(),[])
 invalid=answer();invalid['evidenceIds']=['fact-b']
 assert 'metric:paidOrders' in grounded_review(invalid,basis(),[])['evidenceIds']
 valid=answer();valid['explanation']='A1到A4的观察规则仍需确认。'
 assert grounded_review(valid,basis(),[])['explanation']==valid['explanation']
 valid['explanation']='阶段一至阶段三人数尚未确认。'
 assert grounded_review(valid,basis(),[])['explanation']==valid['explanation']


def test_external_selection_and_hotel_unit_repair_feedback():
 invalid=answer();invalid['selectedSourceIds']=['internal-erp']
 with pytest.raises(ValueError,match='selectedSourceIds'):grounded_review(invalid,basis('hotel'),[])
 invalid=answer();invalid['nextAction']['title']='确认可履约仓'
 with pytest.raises(ValueError,match='酒店履约'):grounded_review(invalid,basis('hotel'),[])
 valid=answer();valid['nextAction']['title']='确认房型可售房晚'
 assert grounded_review(valid,basis('hotel'),[])['nextAction']['title']=='确认房型可售房晚'


def test_known_future_window_is_bound_to_published_profile():
 b=basis('hotel');b['profile']['horizonDays']=3
 valid=answer();valid['explanation']='先核未来三日各房型容量与预订。'
 assert grounded_review(valid,b,[])['explanation']==valid['explanation']
 valid['explanation']='未来四日供给已确认。'
 with pytest.raises(ValueError,match='horizonDays'):grounded_review(valid,b,[])

def test_metric_names_and_chinese_quantities_produce_actionable_strict_repair_error():
    x=answer();x['claims']=[{'metricKey':'refundUnits','value':20}]
    with pytest.raises(ValueError,match='metricKey=refundUnits'):grounded_review(x,basis(),[])
    x=answer();x['hypotheses']=[{'statement':'退款返库二十件','applicability':'本期','evidenceIds':[],'counterevidence':[],'gaps':[]}]
    with pytest.raises(ValueError,match='中文数量 二十件'):grounded_review(x,basis(),[])
    x=answer();x['nextAction']['title']='核对SKU-R1库存'
    with pytest.raises(ValueError,match='含数字的文案'):grounded_review(x,basis(),[])

def test_operating_history_reaches_model_without_promoting_authority(tmp_path):
 class HistoryModel(Model):
  async def call(self,messages,tools=None):
   from semantic_model_stub import semantic_response
   checked=semantic_response(messages)
   if checked:
    self.calls+=1
    return checked,{'total_tokens':50}
   assert messages[0]['role']=='system'
   assert messages[1:3]==[{'role':'user','content':'上轮问缺什么'},{'role':'assistant','content':'上轮核查成本'}]
   assert json.loads(messages[-1]['content'])['basis']['generationId']=='g'
   self.calls+=1
   return {'role':'assistant','content':json.dumps(answer(),ensure_ascii=False)},{'total_tokens':50}
 async def exercise():
  q=JobQueue(tmp_path/'jobs.sqlite');q.initialize();model=HistoryModel()
  j=Job.model_validate({'id':'history-review','businessId':'isolated-a','dataNature':'demo','snapshotId':'g','sessionId':'s','mode':'joint','purpose':'operating','question':'继续核查','history':[{'role':'user','content':'上轮问缺什么'},{'role':'assistant','content':'上轮核查成本'}],'envelope':{'snapshot':{'id':'g','businessId':'isolated-a','dataNature':'demo','asOf':'2026-09-30'},'operatingBasis':basis()},'budget':{'maxModelCalls':5,'maxMarketSearches':0,'maxTokens':60000}}).model_dump(mode='json')
  q.submit(j,source_hash(j))
  async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'checkpoints')) as saver:
   assert await run_once(q,'worker',saver,model_factory=lambda:model)
   assert q.observe(j['id'])['status']=='completed'
   assert model.calls==5
 asyncio.run(exercise())

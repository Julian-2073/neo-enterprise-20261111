"""Saved failed live inputs; offline protocol/admission evidence, never quality scoring."""
import asyncio,copy,gzip,json
from pathlib import Path
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.execution import ExecutionError,reserve_input
from neo_agent.runtime import NeoRuntime
from neo_agent.operating_reviews import grounded_review
from neo_agent.scoped_queries import lossless_prompt_view,scoped_read
from neo_agent.task_plan import plan_task
from test_unified_runtime import execute
from semantic_model_stub import semantic_response
F=Path(__file__).parent/'fixtures'

def test_actual_legacy_customer_page_count_query_is_deterministic_and_uses_no_model(tmp_path):
    job=json.loads(gzip.decompress((F/'task4-live-legacy-query.json.gz').read_bytes()))
    assert job['question']=='当前统计期支付订单和退款分别有多少笔？'
    class CountAdapter:
        name='deepseek-flash'
        def __init__(self):self.calls=0
        async def call(self,messages,tools=None):
            self.calls+=1;raise AssertionError('订单事实查询不应调用模型')
    model=CountAdapter();result,_=execute(tmp_path,job,model)
    assert result['status']=='completed',result
    assert model.calls==0 and result['observability']['limits']['maxTokens'] is None
    assert result['observability']['limits']['maxModelCalls'] is None
    assert result['observability']['modelInvocations']==0
    assert result['result']['finding']['conclusion']=='统计期内支付订单223笔（240件），退款订单19笔（21件）。'
    assert result['result']['businessAssessment']['metrics']['conversion']['paidOrders']==223


def test_recorded_refund_responses_reach_joint_within_unchanged_remaining_budget():
    f=json.loads((F/'task4-live-refund-replay.json').read_text());reserves=[]
    class Replay:
        name='deepseek-flash'
        async def call(self,messages,tools=None):
            i=len(reserves);reserves.append(reserve_input(messages,tools,[])[0]+2000)
            if i==3:
                spent=sum(json.loads(c['usage'])['total_tokens'] for c in f['calls'])
                assert spent==29291 and spent+reserves[-1]<=60000
                raise ExecutionError('bounded offline capture before unrecorded joint response','OFFLINE_STOP')
            return json.loads(f['calls'][i]['response']),json.loads(f['calls'][i]['usage'])
    async def run():
        async with AsyncSqliteSaver.from_conn_string(':memory:') as saver:
            with pytest.raises(ExecutionError,match='offline capture'):
                await NeoRuntime(saver,Replay()).graph.ainvoke({'job':f['job']},{'configurable':{'thread_id':'replay'}})
    asyncio.run(run());assert len(reserves)==4
    assert plan_task(f['job'])['selected']==['conversion','supply']
    assert plan_task({**f['job'],'question':'诊断退款和毛利'})['selected']==['conversion']
    assert plan_task({**f['job'],'question':'退款与渠道投放费用变化'})['selected']==['conversion','market']


def test_actual_sku_rejected_absence_is_repaired_by_same_grounding_gate_not_published():
    f=json.loads((F/'task4-live-sku-rejected.json').read_text());basis={**f['job']['envelope']['operatingBasis'],'activeScope':f['job']['envelope']['conversation']['active']};draft=json.loads(f['draft']['content'])
    assert basis['metrics']['refundUnits']['status']=='complete' and basis['metrics']['refundUnits']['value']==0
    with pytest.raises(ValueError,match='已确认所选范围'):grounded_review(draft,basis,[])
    out=scoped_read(basis,'read_saved_records',{'kind':'refund'});assert out['status']=='wrong_record_domain' and out['businessRecordsAvailability']=='not_assessed'
    assert scoped_read(basis,'read_frozen_records',{'kind':'order','entryType':'refund'})['total']==0
    assert scoped_read(basis,'read_frozen_records',{'kind':'order','entryType':'paid'})['total']==1


def test_lossless_prompt_references_roundtrip_every_value_scope_null_and_counterevidence():
    f=json.loads((F/'task4-live-refund-replay.json').read_text());value={'basis':f['job']['envelope']['operatingBasis'],'counterevidence':['同长度前后期的指标、身份或来源覆盖不足']*4};wire=lossless_prompt_view(value)
    def restore(item):
        if isinstance(item,dict) and set(item)=={'$sameAs'}:
            original=value
            for part in item['$sameAs'].split('/')[1:]:
                key=part.replace('~1','/').replace('~0','~');original=original[int(key)] if isinstance(original,list) else original[key]
            return copy.deepcopy(original)
        if isinstance(item,dict):return {k:restore(v) for k,v in item.items()}
        if isinstance(item,list):return [restore(v) for v in item]
        return item
    assert restore(wire)==value
    assert len(json.dumps(wire,ensure_ascii=False))<len(json.dumps(value,ensure_ascii=False))

@pytest.mark.parametrize('question,expected',[
 ('那支付和退款的商品件数呢？','QUERY'),('退款商品数量呢','QUERY'),('那支付笔数？','QUERY'),('本期退款金额呢？','QUERY'),
 ('为什么退款件数增加？','EXPLAIN'),('诊断退款件数异常','DIAGNOSE'),('分析退款件数呢？','DIAGNOSE'),('如果退款件数增加呢？','SIMULATE')])
def test_metric_name_followups_do_not_override_explicit_analysis_intents(question,expected):
    from neo_agent.task_plan import recognize_task
    assert recognize_task({'question':question,'mode':'conversion'})==expected


def test_actual_saved_unit_followup_replanned_before_new_admission_preserves_context_and_query_fence(tmp_path):
    import hashlib
    from neo_agent.task_plan import recognize_task
    from neo_agent.ontology import expand_ontology
    from neo_agent.agent import order_query_metrics
    raw=gzip.decompress((F/'task4-live-unit-followup.json.gz').read_bytes());lineage=json.loads((F/'task4-live-unit-followup-lineage.json').read_text());assert hashlib.sha256(raw).hexdigest()==lineage['rawPayloadSha256']
    saved=json.loads(raw);assert saved['taskType']=='DIAGNOSE'
    job=copy.deepcopy(saved);del job['taskType'];job['id']='offline-unit-followup';job['taskType']=recognize_task(job)
    env=expand_ontology(job['envelope']);assert env['conversation']['sessionId']==saved['sessionId'];assert env['conversation']['previousInputId']==saved['snapshotId']
    assert env['snapshot']['periodStart']=='2026-04-06' and env['snapshot']['periodEnd']=='2026-09-20'
    assert '当前统计期支付订单和退款分别有多少笔？' in json.dumps(env['conversation'],ensure_ascii=False)
    assert order_query_metrics(job['question'])=={'paidUnits','refundUnits'}
    assert plan_task(job)['taskType']=='QUERY' and 'search_market' not in plan_task(job)['tools']
    class UnitsAdapter:
        name='deepseek-flash'
        def __init__(self):self.calls=0
        async def call(self,messages,tools=None):
            self.calls+=1;raise AssertionError('件数事实查询不应调用模型')
    model=UnitsAdapter();result,_=execute(tmp_path,job,model);assert result['status']=='completed',(result['error'],model.calls,model.reserves,getattr(model,'repair',None))
    assert model.calls==0 and result['observability']['limits']['maxTokens'] is None and result['observability']['limits']['maxModelCalls'] is None
    assert result['observability']['modelInvocations']==0
    assessment=result['result']['businessAssessment'];assert assessment['metrics']['conversion']['paidUnits']==240 and assessment['metrics']['conversion']['refundUnits']==21
    assert all({r['id'].rsplit(':',1)[-1] for r in claim['supportingReferences']}=={'paidUnits','refundUnits'} for claim in assessment['claims'])
    assert assessment['context']['taskBudgetClass']=='simple' and not assessment.get('hypotheses') and not assessment['priorityAction']

import asyncio,json
from datetime import date,timedelta
import pytest,httpx
from neo_agent.providers import Model,Market,ProviderError,source_readable
from neo_agent.mcp import FirecrawlMCP
from neo_agent.agent import AgentRuntime,model_tool_data
from neo_agent.engine import evaluate_weekly
from test_engine import fixture

def test_backtest_does_not_hide_sku_errors():
 w=[date(2026,1,5)+timedelta(days=7*i) for i in range(18)]
 r=evaluate_weekly({'s1':[1,9]*9,'s2':[9,1]*9},w)
 assert r['wape']['fourWeekMean']==.8 and r['aggregateWape']['fourWeekMean']==0
 assert r['sampleEnd']==(w[15]+timedelta(days=6)).isoformat()

def test_error_page_not_evidence():
 assert not source_readable('![](https://cdn.example/405.png)','405')
 assert not source_readable('a'*300,'Forbidden',403)
 assert source_readable('国务院政策正文。'*100,'政策意见',200)

def test_mcp_tool_allowlist():
 client=object.__new__(FirecrawlMCP);client.tools={'firecrawl_search','shell'}
 with pytest.raises(ProviderError,match='授权范围'):asyncio.run(client.call('shell',{}))

def test_deepseek_payload_and_transient_retry(monkeypatch):
 monkeypatch.setenv('LLM_API_KEY','TEST_ONLY');monkeypatch.setenv('LLM_MODEL','deepseek-flash');monkeypatch.setenv('LLM_BASE_URL','https://api.deepseek.com/v1')
 count=0
 async def handler(request):
  nonlocal count;count+=1;p=json.loads(request.content)
  assert p['thinking']=={'type':'enabled'} and p['model']=='deepseek-flash'
  if count==1:raise httpx.ConnectError('temporary',request=request)
  return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'{}'}}],'usage':{'total_tokens':1}})
 original=httpx.AsyncClient
 monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
 assert asyncio.run(Model().call([{'role':'user','content':'test'}]))[1]['total_tokens']==1 and count==2

class RepairModel:
 name='OFFLINE_TEST_ADAPTER'
 def __init__(self):self.calls=0
 async def call(self,messages,tools=None):
  self.calls+=1
  if self.calls==1:return {'role':'assistant','content':None,'tool_calls':[{'id':'map','type':'function','function':{'name':'describe_business','arguments':'{}'}},{'id':'t','type':'function','function':{'name':'read_business','arguments':'{"section":"conversion"}'}},{'id':'decisions','type':'function','function':{'name':'read_decisions','arguments':'{}'}}]},{}
  f={'conclusion':'固定证据','evidenceIds':['wrong' if self.calls==2 else 'ev1'],'alternatives':[],'gaps':[],'candidates':[],'followups':[]}
  return {'role':'assistant','content':json.dumps(f)},{}

def test_one_evidence_repair_without_silent_rewrite():
 async def run():
  model=RepairModel();runtime=AgentRuntime(None,model=model)
  f,_,_,_=await runtime.specialist({'job':{'id':'j','mode':'orchestrator','question':'test','dataNature':'demo','envelope':fixture()}},'orchestrator')
  assert f['evidenceIds']==['ev1'] and model.calls==3
 asyncio.run(run())


def test_model_money_uses_yuan_without_mutating_business_cents():
 source={'financial':{'netRevenueCents':239030400,'contributionMarginCents':None},'inventory':[{'inventory_cost_cents':850050,'sellable_units':4}], 'priceMultiplier':.9}
 result=model_tool_data(source)
 assert result['financial']=={'netRevenueYuan':2390304.0,'contributionMarginYuan':None}
 assert result['inventory'][0]=={'inventory_cost_yuan':8500.5,'sellable_units':4}
 assert source['financial']['netRevenueCents']==239030400 and result['priceMultiplier']==.9

import asyncio,json,gzip,base64
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.ontology import query_objects,expand_ontology
from neo_agent.agent import AgentRuntime
from neo_agent.providers import ProviderError
from test_engine import fixture
from test_agents import MockModel

def object_env():
    e=fixture();e['ontologyRef']={'buildId':'build-x','asOf':'2026-09-30','knownAt':'2026-10-01T00:00:00Z'}
    e['ontology']={'ref':e['ontologyRef'],'definition':{'types':[{'id':'sku','properties':{'id':{'type':'string'},'productId':{'type':'string'},'units':{'type':'number'}}},{'id':'product','properties':{'id':{'type':'string'}}}], 'links':[{'id':'sku_product','from':'sku','to':'product'}]},'objects':[{'typeId':'sku','id':'s','properties':{'id':'s','productId':'p','units':5},'provenance':[{'id':'fact-s'}]},{'typeId':'product','id':'p','properties':{'id':'p'},'provenance':[{'id':'fact-p'}]}], 'links':[{'linkId':'sku_product','fromId':'s','toId':'p'}]};return e

def test_shared_objectset_filters_links_units_and_no_silent_fallback():
    e=object_env();r=query_objects(e,{'typeId':'sku','filters':[{'property':'units','op':'gte','value':3}],'aggregate':{'op':'sum','property':'units'}})
    assert r['aggregate']=={'value':5,'unit':None,'missing':0};assert r['ontologyRef']['buildId']=='build-x';assert r['evidenceIds']==['fact-s']
    assert query_objects(e,{'typeId':'sku','traverse':{'linkId':'sku_product','direction':'out'}})['items'][0]['id']=='p'
    for q in [{'typeId':'other'},{'typeId':'sku','limit':101},{'typeId':'sku','filters':[{'property':'no','op':'eq','value':1}]}]:
        with pytest.raises(ValueError):query_objects(e,q)
    with pytest.raises(ValueError):query_objects(fixture(),{'typeId':'sku'})

class FailedReadModel(MockModel):
    async def call(self,messages,tools=None):
        if messages[-1]['role']!='tool':return {'role':'assistant','tool_calls':[{'id':'d','function':{'name':'describe_business','arguments':'{}'}},{'id':'r','function':{'name':'read_business','arguments':'{"section":"invalid"}'}}]},{}
        return {'role':'assistant','content':json.dumps({'conclusion':'不能在失败读取后放行。','evidenceIds':['ev1'],'alternatives':[],'gaps':[],'candidates':[],'followups':[]})},{}

def test_failed_read_never_admits_conclusion(tmp_path):
    async def run():
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp')) as saver:
            runtime=AgentRuntime(saver,model=FailedReadModel())
            with pytest.raises(ProviderError):await runtime.specialist({'job':{'id':'x','mode':'conversion','question':'q','dataNature':'demo','envelope':fixture()}},'conversion')
    asyncio.run(run())

def test_checkpoint_preserves_completed_specialist_on_later_failure(tmp_path):
    async def run():
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp')) as saver:
            runtime=AgentRuntime(saver,model=MockModel());original=runtime.specialist
            async def fail_second(state,role,extra=''):
                if role=='supply':raise ProviderError('second failed')
                return await original(state,role,extra)
            runtime.specialist=fail_second;config={'configurable':{'thread_id':'partial'}}
            job={'id':'x','mode':'joint','question':'q','dataNature':'demo','snapshotId':'snap1','envelope':fixture()}
            with pytest.raises(ProviderError):await runtime.graph.ainvoke({'job':job},config)
            saved=await runtime.graph.aget_state(config);assert 'conversion' in saved.values['findings'];assert saved.values['toolReads'][1]['status']=='completed'
            runtime.specialist=original;result=await runtime.graph.ainvoke(None,config);assert set(result['result']['specialists'])=={'conversion','supply','market'}
    asyncio.run(run())

class ObjectModel(MockModel):
    async def call(self,messages,tools=None):
        if '为经营问题' in messages[0]['content']:return await super().call(messages,tools)
        if messages[-1]['role']!='tool':return {'role':'assistant','tool_calls':[{'id':'d','function':{'name':'describe_business','arguments':'{}'}},{'id':'q','function':{'name':'query_objects','arguments':'{"typeId":"sku"}'}}]},{}
        return {'role':'assistant','content':json.dumps({'conclusion':'依据当前SKU对象核查库存。','evidenceIds':['fact-s'],'alternatives':[],'gaps':[],'candidates':[],'followups':[]})},{}

def test_agent_object_reads_are_saved_with_actual_evidence(tmp_path):
    async def run():
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp')) as saver:
            r=AgentRuntime(saver,model=ObjectModel());job={'id':'x','mode':'conversion','question':'q','dataNature':'demo','snapshotId':'snap1','envelope':object_env()}
            result=(await r.graph.ainvoke({'job':job},{'configurable':{'thread_id':'object'}}))['result']
            assert result['ontologyRef']['buildId']=='build-x';assert any(r['tool']=='query_objects' and r['status']=='completed' for r in result['toolReads']);assert result['finding']['evidenceIds']==['fact-s']
    asyncio.run(run())

def test_lossless_packed_scope_preserves_every_object_and_rejects_wrong_version():
    e=object_env();o=e.pop('ontology');e['ontologyPacked']={'codec':'gzip-base64','payload':base64.b64encode(gzip.compress(json.dumps(o).encode())).decode()}
    assert expand_ontology(e)['ontology']==o
    assert query_objects(e,{'typeId':'sku'})['total']==1
    e['ontologyRef']={'buildId':'other'}
    with pytest.raises(ValueError):expand_ontology(e)

def test_versioned_policy_denies_custom_types_and_redacts_properties():
    from neo_agent.ontology import policy_view,scalar
    e=object_env();e['ontology']['definition']['links'][0]['property']='productId'
    e['agentPolicy']={'version':'ontology-policy-v2','roles':{'supply':{'tools':['query_objects'],'types':{'sku':['id','productId'],'product':['id']}}}}
    restricted=policy_view(e,'supply')
    assert 'units' not in query_objects(restricted,{'typeId':'sku'})['items'][0]['properties']
    with pytest.raises(ValueError):query_objects(restricted,{'typeId':'sku','filters':[{'property':'units','op':'gte','value':0}]})
    with pytest.raises(ValueError):policy_view(e,'conversion')
    with pytest.raises(ValueError):scalar(-1,{'type':'number','min':0})
    assert scalar(-1,{'type':'number'})==-1

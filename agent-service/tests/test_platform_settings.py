import asyncio,json,base64,gzip
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime,TOOL_SPECS
from neo_agent.platform_settings import configured_tools,configured_instruction,enabled_roles
from neo_agent.providers import ProviderError
from neo_agent.ontology import expand_ontology
from test_engine import fixture
from test_agents import MockModel

def configured_env():
    env=fixture();env['platformConfiguration']={'id':'published-1','agents':{r:{'enabled':r!='market','mission':'优先核对已保存资料','instructions':'优先检查到货日期','tools':[]} for r in ('conversion','supply','market')}};return env

def test_configuration_narrows_tools_and_disabled_roles():
    e=configured_env()
    assert enabled_roles(e,['conversion','market','supply'])==['conversion','supply']
    assert {t['function']['name'] for t in configured_tools(e,'supply',TOOL_SPECS)}=={'describe_business','read_business','query_objects'}
    assert '优先检查到货日期' in configured_instruction(e,'supply')
    with pytest.raises(ProviderError):configured_tools(e,'market',TOOL_SPECS)
    assert configured_instruction(e,'joint')==''

def test_lossless_transport_preserves_published_settings():
    e=configured_env();payload=base64.b64encode(gzip.compress(json.dumps(e).encode())).decode();packed={'envelopePacked':{'codec':'gzip-base64','rawBytes':len(json.dumps(e).encode()),'payload':payload}}
    assert expand_ontology(packed)['platformConfiguration']==e['platformConfiguration']

class ConfiguredModel(MockModel):
    async def call(self,messages,tools=None):
        if '为经营问题' in messages[0]['content']:return {'role':'assistant','content':'{"agents":[]}'},{}
        if '为经营问题' not in messages[0]['content']:
            assert '优先检查到货日期' in messages[0]['content']
            if tools:assert not {'forecast','simulate_scenario','search_market'}&{t['function']['name'] for t in tools}
        return await super().call(messages,tools)

def test_actual_specialist_receives_prompt_and_tool_settings(tmp_path):
    async def run():
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp')) as saver:
            runtime=AgentRuntime(saver,model=ConfiguredModel());job={'id':'cfg','mode':'supply','question':'核对库存','dataNature':'demo','snapshotId':'snap1','envelope':configured_env()}
            output=(await runtime.graph.ainvoke({'job':job},{'configurable':{'thread_id':'cfg'}}))['result']
            assert output['platformConfigurationId']=='published-1'
            assert output['finding']['evidenceIds']
            assert all(r['status']=='completed' for r in output['toolReads'])
            route=await runtime.route({'job':{**job,'mode':'joint'}});assert route['selected']==['conversion','supply']
    asyncio.run(run())

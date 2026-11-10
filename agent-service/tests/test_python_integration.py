"""Behavior at the newer demo business map + reliability + scenario-v1.3 boundary."""
import asyncio, json
from copy import deepcopy
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime, TOOL_SPECS
from neo_agent.business_tools import read_fact_view, describe_business, view_id
from neo_agent.engine import simulate, source_hash
from neo_agent.execution import JournaledModel, ExecutionError
from neo_agent.job_queue import QueueConflict
from test_business_queries import frozen
from test_queue_reliability import setup_queue, make_job, add
from test_agents import MockModel
from test_inventory_scope import unknown_stock
from test_engine import fixture


def test_date_aliases_same_complete_aggregate_and_conflicts_rejected():
    env=frozen()
    a=read_fact_view(env,'market',{'start':'2026-08-24','end':'2026-09-20','grain':'week','comparePrevious':True})
    b=read_fact_view(env,'market',{'periodStart':'2026-08-24','periodEnd':'2026-09-20','grain':'week','comparePrevious':True})
    assert a==b
    with pytest.raises(ValueError,match='不一致'):read_fact_view(env,'market',{'start':'2026-08-24','periodStart':'2026-08-25'})
    with pytest.raises(ValueError,match='冻结'):read_fact_view(env,'market',{'start':'2026-04-05'})
    props=next(t for t in TOOL_SPECS if t['function']['name']=='read_business')['function']['parameters']['properties']
    assert {'start','end','periodStart','periodEnd','inventoryOffset','comparePrevious'}<=props.keys()


def test_names_scoped_week_evidence_and_partial_week_do_not_widen():
    env=frozen(); env['domain']={'products':[{'id':'sim-P1','name':'模拟产品'}]}
    env['snapshot']['data']={'weeks':[{'start':'2026-09-14','end':'2026-09-20'}]}
    assert describe_business(env)['displayNames']['products'][0]['name']=='模拟产品'
    assert describe_business(env)['displayNames']['channels']['content']=='渠道名称待确认'
    whole=read_fact_view(env,'market',{'productId':'sim-P1','channel':'sim-c1','start':'2026-09-14','end':'2026-09-20'})
    assert view_id(env['snapshot']['id'],'week','2026-09-14','netRevenueCents','sim-P1','sim-c1') in whole['scopedEvidenceIds']
    partial=read_fact_view(env,'market',{'productId':'sim-P1','start':'2026-09-15','end':'2026-09-20'})
    assert partial['scopedEvidenceIds']==[]
    assert partial['weeklyMetrics'][0]['start']=='2026-09-15'


def test_channel_query_keeps_warehouse_stock_without_claiming_channel_allocation():
    env=frozen();env['facts'].append({'id':'sim-stock','kind':'inventory','fact':{'sku_id':'sim-S1','product_id':'sim-P1','warehouse_id':'sim-W1','business_date':'2026-09-24','sellable_units':70}})
    r=read_fact_view(env,'supply',{'channel':'sim-c1','productId':'sim-P1'})
    assert r['inventoryPosition']['sellableUnits']==70
    assert 'not_available' in r['inventoryPosition']['channelAllocation']
    assert read_fact_view(env,'supply',{'end':'2026-09-20'})['inventoryPosition']['sellableUnits'] is None


def test_new_business_prompt_and_prose_validator_are_active(tmp_path):
    class Capture(MockModel):
        prompts=[];repairs=0
        async def call(self,messages,tools=None):
            self.prompts.append(messages[0]['content'])
            if '经营表达需要修正' in messages[-1].get('content',''):
                self.repairs+=1
                return {'role':'assistant','content':json.dumps({'conclusion':'已读取经营证据；不能把行为次数称为人数。','evidenceIds':['ev1'],'alternatives':[],'gaps':['没有客户关联'],'candidates':['核实库存'],'followups':[]})},{}
            msg,u=await super().call(messages,tools)
            if messages[-1]['role']=='tool':
                body=json.loads(msg['content']);body['conclusion']='SYNTHETIC_DEMO **内部标识**';msg['content']=json.dumps(body)
            return msg,u
    async def run():
        model=Capture();job=make_job()
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'prompt.sqlite')) as saver:
            result=await AgentRuntime(saver,model=model).graph.ainvoke({'job':job},{'configurable':{'thread_id':job['id']}})
        assert model.repairs==1
        assert any('面向老板说经营语言' in p and '渠道使用 displayNames' in p for p in model.prompts)
        assert 'SYNTHETIC_DEMO' not in result['result']['finding']['conclusion']
    asyncio.run(run())


def test_unknown_demand_result_survives_journal_budget_cancel_and_replay(tmp_path):
    forecast=simulate(unknown_stock(fixture()))
    assert forecast['calculationVersion']=='scenario-v1.3'
    assert forecast['forecastCoverage']['status']=='partial'
    assert forecast['totals']['contributionMarginCents'] is None
    assert next(x for x in forecast['endingInventory'] if x['skuId']=='S-new')['demandStatus']=='unestimated'
    q=setup_queue(tmp_path);j=make_job(budget={'maxModelCalls':1});add(q,j);q.claim('owner')
    class Offline:
        name='integration-offline';calls=0
        async def call(self,*args):
            self.calls+=1;return {'role':'assistant','content':json.dumps(forecast)},{'total_tokens':7}
    async def run():
        delegate=Offline();model=JournaledModel(q,j['id'],delegate,'owner');request=[{'role':'user','content':'模拟预测结果'}]
        original=await model.call(request);assert await model.call(request)==original
        await model.call([{'role':'user','content':'another request'}])
        assert delegate.calls==2
        q.cancel(j['id'])
        with pytest.raises(QueueConflict):q.resume(j['id'])
        assert q.finish(j['id'],'owner','cancelled',{'partial':True,'forecast':json.loads(original[0]['content'])})
        saved=q.observe(j['id'])
        assert saved['result']['forecast']==forecast and saved['result']['partial']
        assert not saved['observability']['cancellationPending']
    asyncio.run(run())

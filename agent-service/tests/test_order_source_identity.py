"""AGG-SOURCE-01: source/order identity is independent of lines and batches."""
from copy import deepcopy
from pathlib import Path
import asyncio,hashlib,json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.business_tools import read_fact_view, view_id
from neo_agent.agent import AgentRuntime
from test_agents import MockModel


INPUT=Path(__file__).resolve().parents[2]/'tests/fixtures/source-collision-input.json'


def collision():
    return json.loads(INPUT.read_text())


def query(env, **args):
    return read_fact_view(env,'market',dict(grain='week',productId='sim-P1',channel='sim-c1',**args))


def test_original_controller_counterexample_and_frozen_input_unchanged():
    before=INPUT.read_bytes();env=collision();raw=deepcopy(env);r=query(env)
    assert r['totals']['paidOrders']==2
    assert r['totals']['paidUnits']==3
    assert r['totals']['netRevenueCents']==30000
    assert r['totals']['metricStatus']['paidOrders']['status']=='observed'
    assert r['weeklyTotals'][0]['paidOrders']==2
    assert r['productChannelAggregates'][0]['paidOrders']==2
    assert r['weeklyMetrics'][0]['groups'][0]['paidOrders']==2
    assert r['queryEvidence']['scope']==r['scope']
    assert r['queryEvidence']['matchingFactIdsHash']==hashlib.sha256(json.dumps(sorted(x['id'] for x in env['facts'])).encode()).hexdigest()
    assert view_id(env['snapshot']['id'],'week','2026-09-14','paidOrders','sim-P1','sim-c1') in r['scopedEvidenceIds']
    assert env==raw and INPUT.read_bytes()==before


def test_same_source_across_batches_and_lines_is_one_order():
    env=collision()
    for i,row in enumerate(env['facts']):row.update(sourceId='sim-source-A',batchId='sim-batch-'+str(i))
    r=query(env)
    assert r['totals']['paidOrders']==1 and r['totals']['paidUnits']==3
    assert r['totals']['netRevenueCents']==30000


def test_older_explicit_raw_source_id_alias_is_a_stable_identity():
    env=collision()
    for row in env['facts']:row['source_id']=row.pop('sourceId')
    assert query(env)['totals']['paidOrders']==2


def test_conflicting_source_aliases_rejected_without_rewriting_input():
    env=collision();env['facts'][0]['source_id']='other-source';before=deepcopy(env)
    with pytest.raises(ValueError,match='来源身份冲突'):query(env)
    assert env==before


def test_missing_all_sources_legacy_cardinality_is_audit_only_not_actual_orders():
    env=collision()
    for row in env['facts']:row.pop('sourceId');row['batchId']='sim-batch-'+row['id']
    r=query(env)
    assert r['totals']['paidOrders'] is None
    status=r['totals']['metricStatus']['paidOrders']
    assert status['status']=='missing' and status['missingSourceRows']==3
    assert status['knownValue'] is None and status['legacyDistinctOrderIds']==1
    assert view_id(env['snapshot']['id'],'week','2026-09-14','paidOrders','sim-P1','sim-c1') not in r['scopedEvidenceIds']
    assert view_id(env['snapshot']['id'],'week','2026-09-14','netRevenueCents','sim-P1','sim-c1') in r['scopedEvidenceIds']
    assert r['totals']['paidUnits']==3 and r['totals']['netRevenueCents']==30000


@pytest.mark.parametrize('same_id',[True,False])
def test_mixed_known_unknown_sources_never_merged_or_assumed_new(same_id):
    env=collision();env['facts'][2].pop('sourceId')
    if not same_id:env['facts'][2]['fact']['order_id']='sim-different-order'
    r=query(env)
    assert r['totals']['paidOrders'] is None
    status=r['totals']['metricStatus']['paidOrders']
    assert status['status']=='partial' and status['knownValue']==1
    assert status['missingSourceRows']==1 and status['legacyDistinctOrderIds']==1
    assert r['totals']['netRevenueCents']==30000


@pytest.mark.parametrize('field,value',[('sourceId',''),('sourceId',None),('sourceId',42),('order_id',''),('order_id',None),('order_id',42)])
def test_missing_or_invalid_identity_marks_count_partial(field,value):
    env=collision();row=env['facts'][0]
    (row['fact'] if field=='order_id' else row)[field]=value
    r=query(env);status=r['totals']['metricStatus']['paidOrders']
    assert r['totals']['paidOrders'] is None and status['status']=='partial'
    assert status['missingRows']==1 and r['totals']['netRevenueCents']==30000


def test_refund_orders_follow_same_identity_rule_and_signed_money_unchanged():
    env=collision()
    for row in env['facts']:row['fact']['entry_type']='refund'
    r=query(env)
    assert r['totals']['refundOrders']==2 and r['totals']['refundUnits']==3
    assert r['totals']['paidOrders'] is None and r['totals']['netRevenueCents']==-30000
    env['facts'][2].pop('sourceId');r=query(env)
    assert r['totals']['refundOrders'] is None
    assert r['totals']['metricStatus']['refundOrders']['status']=='partial'
    assert r['totals']['netRevenueCents']==-30000


def test_week_previous_legacy_date_aliases_and_count_growth_share_identity():
    env=collision();env['snapshot']['periodStart']='2026-09-07'
    env['snapshot']['data']['weeks'].insert(0,{'start':'2026-09-07','end':'2026-09-13'})
    for c in env['snapshot']['coverage']:c['start']='2026-09-07'
    previous=deepcopy(env['facts'])
    for row in previous:row['id']+='-prev';row['sourceId']='sim-source-A';row['fact']['business_date']='2026-09-07'
    env['facts']+=previous
    args={'periodStart':'2026-09-14','periodEnd':'2026-09-20','comparePrevious':True}
    r=query(env,**args)
    assert r['totals']['paidOrders']==2
    assert r['previousPeriod']['totals']['paidOrders']==1
    assert r['previousPeriod']['comparison']['paidOrders']=={'difference':1,'relativeChange':1.0,'status':'comparable','reason':None}
    assert r['previousPeriod']['totals']['netRevenueCents']==30000
    aliases=query(env,start='2026-09-14',end='2026-09-20',comparePrevious=True)
    assert aliases==r
    # Missing source in the earlier period cannot generate apparent growth.
    previous[0].pop('sourceId')
    r=query(env,**args)
    assert r['previousPeriod']['totals']['paidOrders'] is None
    assert r['previousPeriod']['comparison']['paidOrders']['status']=='missing'
    assert r['previousPeriod']['comparison']['paidOrders']['difference'] is None


def test_multiple_products_channels_and_pages_preserve_full_counts_and_scope():
    env=collision();rows=[]
    for i in range(66):
        for row in deepcopy(env['facts']):
            row['id']+='-'+str(i);row['fact'].update(product_id='sim-P'+str(i),channel='sim-c'+str(i%2),order_id='order-'+str(i));rows.append(row)
    env['facts']=rows
    a=read_fact_view(env,'market',{'grain':'week'});b=read_fact_view(env,'market',{'grain':'week','aggregateOffset':60})
    assert a['totals']['paidOrders']==132 and a['totals']['paidUnits']==198
    assert a['totals']['netRevenueCents']==66*30000
    assert a['totals']==b['totals'] and a['weeklyTotals']==b['weeklyTotals']
    assert a['weeklyTotals'][0]['paidOrders']==132
    assert len(a['productChannelAggregates'])==60 and len(b['productChannelAggregates'])==6
    assert all(g['paidOrders']==2 for g in a['productChannelAggregates']+b['productChannelAggregates'])
    part=query(env)
    assert part['totals']['paidOrders']==2 and part['totals']['paidUnits']==3
    assert part['factCount']==3 and len(part['facts'])==3


def test_agent_legacy_financial_alias_has_same_count_and_money(tmp_path):
    class Capture(MockModel):
        outputs=[]
        async def call(self,messages,tools=None):
            if messages[-1]['role']=='tool':self.outputs.extend(json.loads(m['content'])['result'] for m in messages if m['role']=='tool' and m['tool_call_id']=='t1')
            msg,u=await super().call(messages,tools)
            for call in msg.get('tool_calls',[]):
                if call['function']['name']=='read_business':call['function']['arguments']=json.dumps({'section':'conversion','productId':'sim-P1','channel':'sim-c1','start':'2026-09-14','end':'2026-09-20'})
            return msg,u
    async def run():
        env=collision();env['snapshot'].update(limitations=[],evidenceIds={'orders':'ev1'})
        job={'id':'sim-order-source-alias','businessId':env['snapshot']['businessId'],'snapshotId':env['snapshot']['id'],'dataNature':'demo','sessionId':'sim-session','mode':'conversion','question':'核对订单笔数','envelope':env}
        model=Capture()
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'source-alias.sqlite')) as saver:
            await AgentRuntime(saver,model=model).graph.ainvoke({'job':job},{'configurable':{'thread_id':job['id']}})
        out=model.outputs[-1]
        assert out['financial']['paidOrders']==out['totals']['paidOrders']==2
        assert out['financial']['netRevenueYuan']==300
        assert out['scope']['productId']=='sim-P1' and out['scope']['channel']=='sim-c1'
    asyncio.run(run())

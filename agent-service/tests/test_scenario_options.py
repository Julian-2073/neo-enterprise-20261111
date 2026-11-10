import asyncio,json
from copy import deepcopy
import pytest
from test_asof_backtest import hand_fixture as raw_fixture

def hand_fixture():
    env=raw_fixture();env["snapshot"]["evidenceIds"]={"paidUnits":"fixture-paid"};env["domain"]["products"]=[{"id":env["facts"][0]["fact"]["product_id"]}];env["domain"]["skus"]=[{"id":env["facts"][0]["fact"]["sku_id"]}];return env
from neo_agent.scenario_options import ScenarioOptionsRuntime,validate_options,scenario_replay


def basis(env):
    return {'baselineId':'baseline-1','baseline':{'id':'baseline-1','totals':{}},'generatedAt':'2026-10-09T00:00:00Z','externalSources':[]}


def options(env):
    eid=next(iter(env['snapshot']['evidenceIds'].values()))
    return {'options':[{'id':i,'title':f'建议{i}','summary':'核查后调整需求条件','rationale':'依据当前经营数据','evidenceIds':[eid],'externalEvidenceIds':[],'conditions':['需求响应仍须验证'],'assumptions':{'adjustments':[{'productId':env['domain']['products'][0]['id'],'conversionMultiplier':v,'assumption':{'source':'model_hypothesis','note':'AI条件假设，非已验证作用','confirmed':False}}]}} for i,v in zip('ABC',[1,1.1,.9])]}


def test_three_options_scope_and_hypotheses():
    env=hand_fixture();b=basis(env);value=options(env)
    assert len(validate_options(value,env,b)['options'])==3
    for invalid in [value['options'][:2],[value['options'][0]]*3]:
        with pytest.raises(ValueError):validate_options({'options':invalid},env,b)
    bad=deepcopy(value);bad['options'][0]['evidenceIds']=['foreign-evidence']
    with pytest.raises(ValueError):validate_options(bad,env,b)
    bad=deepcopy(value);bad['options'][0]['assumptions']['adjustments'][0]['productId']='foreign-product'
    with pytest.raises(ValueError):validate_options(bad,env,b)
    bad=deepcopy(value);bad['options'][0]['assumptions']['adjustments'][0]['assumption']['confirmed']=True
    with pytest.raises(ValueError):validate_options(bad,env,b)


def test_replay_uses_ai_parameters_on_identical_historical_folds():
    env=hand_fixture();a=options(env)['options'][1]['assumptions'];product=env['facts'][0]['fact']['product_id'];a['adjustments'][0]['productId']=product
    replay=scenario_replay(env,a)
    assert replay['status']=='replayed' and replay['policyBacktestStatus']=='not_validated'
    assert replay['scenarioMetrics']['predictedUnits']==pytest.approx(replay['baselineMetrics']['predictedUnits']*1.1)
    assert replay['scenarioMetrics']['actualUnits']==replay['baselineMetrics']['actualUnits']
    assert replay['foldCount']==4 and replay['assumptionsHash']
    env['facts'][7]['availableAt']=None
    assert scenario_replay(env,a)['skippedFolds'][0]['reason']=='training_observations_unavailable'


def test_insufficient_history_stays_unavailable():
    env=hand_fixture();env['snapshot']['periodStart']=env['snapshot']['periodEnd']
    r=scenario_replay(env,{})
    assert r['status']=='unavailable' and r['historyStatus']=='insufficient_history' and r['scenarioMetrics'] is None


def test_truncation_regenerates_complete_options_from_frozen_input():
    env=hand_fixture();env['scenarioRecommendationBasis']=basis(env)
    class Model:
        name='fixture';calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            if self.calls==1:return {'content':'{"options":[]}','_finish_reason':'length'},{}
            assert all('"options":[]' not in m['content'] for m in messages)
            return {'content':json.dumps(options(env)),'_finish_reason':'stop'},{}
    model=Model();runtime=ScenarioOptionsRuntime(None,model)
    r=asyncio.run(runtime.generate({'job':{'id':'r','businessId':env['snapshot']['businessId'],'snapshotId':env['snapshot']['id'],'dataNature':'demo','envelope':env}}))
    assert len(r['result']['scenarioRecommendations']['options'])==3 and model.calls==2


def test_response_formula_and_relative_action_window_match_scenario_engine():
    env=hand_fixture();a=options(env)['options'][1]['assumptions'];x=a['adjustments'][0]
    x.update(conversionMultiplier=1,budgetMultiplier=2,budgetResponse=.5)
    replay=scenario_replay(env,a)
    assert replay['scenarioMetrics']['predictedUnits']==pytest.approx(replay['baselineMetrics']['predictedUnits']*2**.5)
    from datetime import date,timedelta
    origin=date.fromisoformat(env['snapshot']['asOf']);x.update(start=(origin+timedelta(days=1)).isoformat(),end=(origin+timedelta(days=7)).isoformat())
    scoped=scenario_replay(env,a)
    assert scoped['scenarioMetrics']['predictedUnits']<replay['scenarioMetrics']['predictedUnits']
    assert scoped['dateMapping']=='relative_horizon_day'


def test_prompt_projection_bounds_repeated_audit_data_without_changing_inputs():
    from neo_agent.scenario_options import prompt_basis
    env=hand_fixture();b=basis(env)
    product=env['domain']['products'][0]['id']
    env['domain']['products'][0].update(name='测试商品',auditBlob='x'*100000)
    b['externalSources']=[{'id':f'source-{i}','url':'https://example.invalid/original','title':'原文','verificationStatus':'source_read','content':'[正文](https://example.invalid/tracking?q='+('x'*10000)+')\n'+'资料'*10000,'unusedBlob':'x'*100000} for i in range(20)]
    before=deepcopy(env);original=deepcopy(b);view=prompt_basis(env,b)
    assert len(json.dumps(view,ensure_ascii=False).encode())<30000
    assert view['entities']['products'][0]['id']==product
    assert view['contextCoverage']['externalSourceCount']==20
    assert len(view['externalSources'])==6 and view['externalSources'][0]['excerpt'].startswith('正文')
    assert view['externalSources'][0]['excerptOnly'] is True
    assert any(r['productId']==product for r in view['business']['productChannelAggregates']['records'])
    assert env==before and b==original


def test_changed_budget_and_price_need_named_response_coefficients():
    env=hand_fixture();b=basis(env);value=options(env);x=value['options'][1]['assumptions']['adjustments'][0]
    x['budgetMultiplier']=1.1
    with pytest.raises(ValueError,match='budgetResponse'):validate_options(value,env,b)
    x['budgetResponse']=.4;x['priceMultiplier']=1.02
    with pytest.raises(ValueError,match='priceElasticity'):validate_options(value,env,b)
    x['priceElasticity']=-1
    assert len(validate_options(value,env,b)['options'])==3

"""New explicitly published synthetic inputs, never timestamp edits to stored data."""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import pytest
from neo_agent.backtesting import evaluate_envelope, METHODS
from neo_agent.engine import simulate, CALCULATION_VERSION
from neo_agent.evaluation import evaluate, scenario_fixture


def published_fixture(env):
    env = deepcopy(env)
    s = env['snapshot']; start = date.fromisoformat(s['periodStart'])
    end = date.fromisoformat(s['periodEnd'])
    # This is a new test construction with predeclared publication assumptions.
    for row in env['facts']:
        row['sourceId'] = 'sim-source-' + row['kind']
        row.setdefault('availableAt', row['fact']['business_date'] + 'T20:00:00+08:00')
    s['coverage'] = [c for c in s['coverage'] if c['kind'] != 'orders']
    cursor = start
    while cursor <= end:
        right = min(cursor + timedelta(days=6), end)
        s['coverage'].append({'kind':'orders', 'sourceId':'sim-source-orders',
            'start':cursor.isoformat(), 'end':right.isoformat(),
            'availableAt':right.isoformat()+'T23:59:59+08:00'})
        cursor += timedelta(days=7)
    env['evaluationMetadata']['publicationAssumption'] = 'NEW_SYNTHETIC_TEST_DECLARATION'
    return env


def hand_fixture():
    env = published_fixture(scenario_fixture())
    env['facts'] = [r for r in env['facts'] if r['kind']=='orders' and r['fact']['entry_type']=='paid' and r['fact']['channel']=='sim-direct']
    for i, row in enumerate(env['facts']): row['fact']['quantity'] = i + 1
    return env


def test_hand_calculation_and_shared_formal_method():
    env = hand_fixture(); result = evaluate(env)
    assert result['status']=='evaluated' and result['methodVersion']=='asof-backtest-v2'
    assert len(result['folds'])==4
    first = result['folds'][0]
    assert [c['actualUnits'] for c in first['cells']]==[9,10,11,12]
    assert [c['predictions']['fourWeekMean'] for c in first['cells']]==[6.5]*4
    assert [c['predictions']['lastWeek'] for c in first['cells']]==[8]*4
    assert [c['predictions']['seasonalNaive4'] for c in first['cells']]==[5,6,7,8]
    for m, error in [('fourWeekMean',16),('lastWeek',10),('seasonalNaive4',16)]:
        assert first['metrics'][m]['actualUnits']==42
        assert first['metrics'][m]['absoluteErrorUnits']==error
        assert first['metrics'][m]['wape']==error/42
    engine = simulate(env)['backtest']
    assert engine['foldResults']==result['folds'] and engine['wape']=={m:result['metrics'][m]['wape'] for m in METHODS}
    assert CALCULATION_VERSION=='scenario-v1.3'
    # Core is enterprise neutral; the offline adapter's demo restriction stays local.
    env['snapshot']['businessId']='another-business'
    assert evaluate_envelope(env)['metrics']==result['metrics']


@pytest.mark.parametrize('stamp',[None,'2026-05-26T20:00:00','nonsense','2026-02-30T20:00:00+08:00','2026-06-01T00:00:00+08:00'])
def test_missing_invalid_or_late_training_is_gap_not_zero(stamp):
    env=hand_fixture(); env['facts'][7]['availableAt']=stamp
    result=evaluate(env)
    assert result['status']!='evaluated'
    assert result['skippedFolds'][0]['trainEnd']=='2026-05-31'
    assert result['skippedFolds'][0]['reason']=='training_observations_unavailable'
    assert env['facts'][7]['id'] in result['skippedFolds'][0]['rowIds']


def test_late_revision_does_not_rewrite_earlier_training():
    env=hand_fixture(); before=evaluate(env)['folds'][0]
    row=deepcopy(env['facts'][7]); row.update(id='late-revision',revisionOf=row['id'],availableAt='2026-06-01T00:00:00+08:00')
    row['fact']['quantity']=999; env['facts'].append(row)
    after=evaluate(env)['folds'][0]
    assert after['trainingHash']==before['trainingHash']
    assert after['cells']==before['cells']
    assert after['lateTrainingRowsExcluded']==1
    assert 'late-revision' not in {r['id'] for r in after['trainingRows']}


def test_future_key_labels_and_holdout_do_not_fit_prefix():
    env=hand_fixture(); before=evaluate(env)['folds'][0]
    row=deepcopy(env['facts'][8]); row.update(id='new-product')
    row['fact'].update(product_id='future-product',sku_id='future-sku',quantity=100)
    env['facts'].append(row)
    after=evaluate(env)['folds'][0]
    assert after['trainingHash']==before['trainingHash']
    future=[c for c in after['cells'] if c['skuId']=='future-sku']
    assert all(c['coldStart'] and all(p==0 for p in c['predictions'].values()) for c in future)
    assert sum(c['actualUnits'] for c in future)==100
    assert [c for c in after['cells'] if c['skuId']!='future-sku']==before['cells']


@pytest.mark.parametrize('mutation',['missing','unknown','late','gap','missing-source'])
def test_coverage_must_have_closed_published_history(mutation):
    env=hand_fixture(); cs=env['snapshot']['coverage']
    if mutation=='missing': env['snapshot']['coverage']=[c for c in cs if c['kind']!='orders']
    elif mutation=='unknown':
        for c in cs: c.pop('availableAt',None)
    elif mutation=='late':
        for c in cs: c['availableAt']='2026-12-31T20:00:00+08:00'
    elif mutation=='gap': env['snapshot']['coverage']=[c for c in cs if c['start']!='2026-04-20']
    else:
        for row in env['facts']: row.pop('sourceId')
    result=evaluate(env)
    assert result['status']=='insufficient_coverage' and len(result['skippedFolds'])==4
    assert all(v['wape'] is None for v in result['metrics'].values())


def test_shanghai_origin_boundary_and_label_cutoff():
    env=hand_fixture(); env['facts'][7]['availableAt']='2026-05-31T15:59:59.999999Z'
    assert evaluate(env)['folds'][0]['trainEnd']=='2026-05-31'
    env['facts'][7]['availableAt']='2026-05-31T16:00:00Z'
    assert evaluate(env)['skippedFolds'][0]['trainEnd']=='2026-05-31'
    env=hand_fixture(); env['facts'][8]['availableAt']='2026-09-25T00:00:00+08:00'
    result=evaluate(env)
    assert result['skippedFolds'][0]['reason']=='label_observations_unavailable'


def test_original_actual_input_and_all_future_read_only():
    root=Path(__file__).resolve().parents[2]
    p=root/'tests/fixtures/asof-controller-envelope.json'; raw=p.read_bytes()
    assert hashlib.sha256(raw).hexdigest()=='09cfc1670340a2accf3eca964a8242e6a6cbee7cab75ff7bc61fb4430d08f14e'
    env=json.loads(raw)
    original=simulate(env)
    assert original['backtest']['status']==evaluate(env)['status']=='no_paid_series'
    assert original['totals']['units']==35
    assert original['totals']['netRevenueCents']==8245337
    assert original['totals']['contributionMarginCents']==-29662
    future=deepcopy(env)
    for row in future['facts']: row['availableAt']='2026-12-31T23:59:59+08:00'
    assert simulate(future)['backtest']['status']==evaluate(future)['status']=='no_paid_series'
    assert simulate(future)['totals']==original['totals']
    assert p.read_bytes()==raw


def test_zero_holdout_is_observed_only_with_published_coverage():
    env=hand_fixture();env['facts']=env['facts'][:8]
    result=evaluate(env)
    assert result['status']=='evaluated'
    assert result['folds'][0]['metrics']['fourWeekMean']['wape'] is None
    assert result['folds'][0]['metrics']['fourWeekMean']['maeUnits']==6.5
    env['snapshot']['coverage']=[c for c in env['snapshot']['coverage'] if c['kind']!='orders' or c['end']<='2026-05-31']
    assert evaluate(env)['status']=='insufficient_coverage'


def test_after_test_end_and_after_period_end_do_not_enter_earlier_cells():
    env=hand_fixture();before=evaluate(env)['folds'][0]
    env['facts'][12]['fact']['quantity']=99999
    outside=deepcopy(env['facts'][0]);outside['id']='outside-period';outside['fact']['business_date']='2026-09-21';outside['availableAt']=None
    env['facts'].append(outside)
    result=evaluate(env)
    assert result['folds'][0]==before
    assert result['availability']['outOfWindowOrderRowsExcluded']==1

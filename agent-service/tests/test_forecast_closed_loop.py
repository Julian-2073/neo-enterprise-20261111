from copy import deepcopy
from datetime import date,timedelta
import pytest
from test_engine import fixture
from neo_agent.engine import simulate,evaluate_weekly,evaluate_forecast

def test_sku_channel_week_lines_reconcile_and_features_remain_read_only():
    env=fixture(stock=30);before=deepcopy(env);r=simulate(env)
    assert len(r['forecastLines'])==4
    assert sum(l['fulfillableUnits'] for l in r['forecastLines'])==pytest.approx(r['totals']['units'])
    assert sum(l['salesBaselineUnits'] for l in r['forecastLines'])==pytest.approx(56)
    assert r['featureSnapshots'][0]['lag1Units']==14
    assert env==before

def test_same_four_week_folds_and_zero_target_null_wape():
    weeks=[date(2026,1,5)+timedelta(days=i*7) for i in range(20)]
    r=evaluate_weekly({('p','s','c'):[0]*20},weeks)
    assert r['wape']['fourWeekMean'] is None and r['seasonalNaive']['wape'] is None
    assert r['horizonWeeks']==4 and r['seasonalPeriodWeeks']==1
    assert len(r['seriesResults'])==1 and len(r['foldResults'])==3
    assert r['foldResults'][0]['testStart']=='2026-03-02'

def test_later_actuals_evaluate_paid_units_and_missing_coverage_is_explicit():
    early=fixture(16);forecast=simulate(early);later=fixture(20)
    result=evaluate_forecast(later,forecast)
    assert result['status']=='historical_availability_unverified' and result['actualUnits']==56
    assert result['observationStatus']=='complete'
    assert result['benchmark']['status']=='historical_availability_unverified'
    assert result['scores']['salesBaselineUnits']['wape']==pytest.approx(0)
    assert result['availabilityAssessment'].startswith('retrospective')
    short=evaluate_forecast(fixture(8),simulate(fixture(4)))
    assert short['status']=='insufficient_history'
    missing=evaluate_forecast(early,forecast)
    assert missing['observationStatus']=='insufficient_coverage' and len(missing['coverageGaps'])==4

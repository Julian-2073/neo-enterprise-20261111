import copy
import itertools
import math
import pytest
pytest.importorskip('scipy')
from neo_agent.operating_optimizer import solve, tail_mean


def problem():
    def option(sku, q, cash, margin, units):
        return {'id': f'{sku}:{q}', 'quantity': q, 'cashCents': cash,
                'action': {'entityId': sku, 'quantity': q} if q else None,
                'deltaMargin': margin, 'deltaFulfilled': [units]*32}
    return {'version': 'operating-planner-v1', 'businessId': 'fixture', 'dataNature': 'demo', 'generationId': 'g',
            'mission': {'goal': 'contribution_margin', 'cashBudgetCents': 1000, 'minFillRate': .5, 'riskAversion': .5},
            'base': {'margin': [1000]*32, 'fulfilled': [10]*32, 'requested': [30]*32},
            'groups': [
                {'id': 'a', 'options': [option('a', 0, 0, [0]*32, 0), option('a', 10, 600, [800]*32, 10), option('a', 20, 1000, [1800]*16+[-800]*16, 20)]},
                {'id': 'b', 'options': [option('b', 0, 0, [0]*32, 0), option('b', 10, 400, [500]*32, 10)]},
            ]}


def test_milp_matches_independent_enumeration_with_budget_service_and_tail_risk():
    p = problem(); feasible = []
    for chosen in itertools.product(*(g['options'] for g in p['groups'])):
        cash = sum(o['cashCents'] for o in chosen)
        units = [p['base']['fulfilled'][i]+sum(o['deltaFulfilled'][i] for o in chosen) for i in range(32)]
        if cash > p['mission']['cashBudgetCents'] or sum(units)/32 < p['mission']['minFillRate']*30: continue
        profit = [p['base']['margin'][i]+sum(o['deltaMargin'][i] for o in chosen) for i in range(32)]
        utility = sum(profit)/32+p['mission']['riskAversion']*tail_mean(profit)
        feasible.append((utility, -cash, {o['id'] for o in chosen}))
    expected = max(feasible, key=lambda r: r[:2]); result = solve(p)
    assert result['status'] == 'optimal'
    assert set(result['selectedOptionIds']) == expected[2] == {'a:10', 'b:10'}
    assert result['cashCents'] == 1000 and result['expectedFillRate'] == 1
    assert result['executionStatus'] == 'draft_only'


def test_infeasible_never_relaxes_service_or_budget():
    p = problem(); p['mission']['cashBudgetCents'] = 0
    result = solve(p)
    assert result['status'] == 'infeasible' and result['actions'] == []
    assert result['expectedMarginCents'] is None and result['expectedFillRate'] is None


def test_no_demand_or_unnecessary_purchase_selects_zero_with_lowest_cash():
    p = problem(); p['mission'].update(minFillRate=0, riskAversion=0)
    for g in p['groups']:
        for o in g['options']: o['deltaMargin'] = [0]*32; o['deltaFulfilled'] = [0]*32
    p['base'] = {'margin': [0]*32, 'fulfilled': [0]*32, 'requested': [0]*32}
    result = solve(p)
    assert result['status'] == 'optimal' and result['cashCents'] == 0
    assert result['actions'] == [] and result['expectedFillRate'] is None


@pytest.mark.parametrize('change', ['nan', 'bad_scope', 'bad_sample', 'bad_cash'])
def test_invalid_inputs_do_not_produce_solutions(change):
    p = problem()
    if change == 'nan': p['groups'][0]['options'][1]['deltaMargin'][0] = math.nan
    elif change == 'bad_scope': p['version'] = 'other'
    elif change == 'bad_sample': p['base']['margin'].pop()
    else: p['mission']['cashBudgetCents'] = -1
    with pytest.raises(ValueError): solve(p)

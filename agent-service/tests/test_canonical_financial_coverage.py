from test_business_queries import frozen
from neo_agent.business_tools import read_fact_view


def test_partial_margin_is_audit_only_not_a_business_result():
    env = frozen()
    result = read_fact_view(env, 'market', {})
    assert result['totals']['contributionMarginCents'] is not None
    env['snapshot']['coverage'] = [c for c in env['snapshot']['coverage'] if c['kind'] != 'expenses']
    result = read_fact_view(env, 'market', {'grain': 'week'})
    assert result['totals']['contributionMarginCents'] is None
    assert result['totals']['metricStatus']['contributionMarginCents']['knownValueCents'] is not None
    assert all(w['contributionMarginCents'] is None for w in result['weeklyTotals'])
    assert all(w['contributionMarginCents'] is None for w in result['productChannelAggregates'])

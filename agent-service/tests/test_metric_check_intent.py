import pytest
from neo_agent.task_plan import recognize_task, plan_task

@pytest.mark.parametrize('question', ['核对当前订单笔数', '请核对支付件数。', '帮我核对本期退款金额', '请帮我核对一下当前库存量', '核对毛利！'])
def test_explicit_metric_check_is_query(question):
    job={'question':question,'mode':'joint'}
    assert recognize_task(job)=='QUERY'
    plan=plan_task(job)
    assert plan['taskType']=='QUERY'
    assert 'search_market' not in plan['tools']
    assert 'simulate_scenario' not in plan['tools']

@pytest.mark.parametrize('question,expected', [
    ('核对订单下降原因','DIAGNOSE'),
    ('为什么订单下降','EXPLAIN'),
    ('如果增加预算，核对订单笔数','SIMULATE'),
    ('核对库存金额并建议先做什么','DECIDE'),
    ('全面审查并核对本期毛利','REVIEW'),
    ('预测未来销量','FORECAST'),
    ('核对异常库存量','DIAGNOSE'),
    ('请核对上一轮判断的关键依据，分开已知事实、待验证解释和资料缺口。','EXPLAIN'),
])
def test_metric_checks_keep_analysis_and_scenario_precedence(question, expected):
    assert recognize_task({'question':question})==expected

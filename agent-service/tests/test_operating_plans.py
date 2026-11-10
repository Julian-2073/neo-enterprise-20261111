import asyncio
import copy
import json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime
from neo_agent.operating_plans import optimize_plan, read_plan
from test_engine import fixture


def plan_env():
    env = fixture()
    zero = {'id': 'sku:0', 'quantity': 0, 'cashCents': 0, 'action': None, 'deltaMargin': [0]*32, 'deltaFulfilled': [0]*32}
    problem = {'version': 'operating-planner-v1', 'businessId': 'b1', 'dataNature': 'demo', 'generationId': 'snap1',
               'forecastJobId': 'saved-model', 'assumptionSetId': None,
               'mission': {'goal': 'contribution_margin', 'cashBudgetCents': 5000, 'minFillRate': .8, 'riskAversion': .5, 'confirmed': True, 'sourceNote': '演示任务'},
               'base': {'margin': [100]*32, 'fulfilled': [10]*32, 'requested': [10]*32},
               'groups': [{'id': 'sku', 'options': [zero]}], 'environment': {'sampleCount': 32, 'notice': '条件样本'},
               'coverage': {'status': 'partial', 'unestimatedEntityIds': ['new']}, 'limitations': ['仅是条件计算']}
    env['operatingPlanning'] = {'id': 'operating-plan-fixture', 'problem': problem, 'solution': {'status': 'optimal'}}
    env['decisionContext'] = {}
    return env


def test_llm_cannot_change_frozen_prices_budget_or_reduce_risk():
    env = plan_env()
    for args in [{'cashBudgetCents': 100000}, {'unitPrice': 0}, {'riskAversion': 0}, {'goal': 'unknown'}]:
        with pytest.raises(ValueError): asyncio.run(optimize_plan(env, args))
    env['operatingPlanning']['problem']['businessId'] = 'other'
    with pytest.raises(ValueError): read_plan(env)


def test_llm_direction_calls_real_solver_and_preserves_tool_result(tmp_path):
    class ScriptedModel:
        name = 'SCRIPTED_PROTOCOL_TEST'
        def __init__(self): self.step = 0; self.preview = None
        async def call(self, messages, tools=None):
            allowed = {t['function']['name'] for t in tools or []}
            if self.step == 0:
                requests = [('describe_business', {}), ('read_business', {'section': 'supply'}), ('read_decisions', {})]
            elif self.step == 1: requests = [('read_operating_plan', {})]
            elif self.step == 2: requests = [('optimize_operating_plan', {'goal': 'service', 'riskAversion': .8})]
            else:
                self.preview = json.loads(messages[-1]['content'])['result']
                assert self.preview['solution']['status'] == 'optimal'
                assert self.preview['solution']['goal'] == 'service'
                answer = {'conclusion': '演示条件下现有库存满足履约目标，先核对供货条件，再决定是否补货。',
                          'evidenceIds': [self.preview['id']], 'alternatives': [], 'gaps': ['真实精度尚待验收'], 'candidates': ['核查采购报价'], 'followups': [],
                          'operatingRecommendation': {'planningId': self.preview['planningId'], 'previewId': self.preview['id'], 'direction': '履约优先', 'reason': '依据数值求解保持零采购。', 'nextChecks': ['核查实际履约']}}
                return {'role': 'assistant', 'content': json.dumps(answer, ensure_ascii=False)}, {}
            self.step += 1
            assert all(name in allowed for name, args in requests), allowed
            return {'role': 'assistant', 'content': None, 'tool_calls': [
                {'id': f't-{self.step}-{i}', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}} for i, (name, args) in enumerate(requests)]}, {}
    async def run():
        env = plan_env(); original = copy.deepcopy(env['operatingPlanning']['problem'])
        j = {'id': 'planner-protocol', 'businessId': 'b1', 'dataNature': 'demo', 'snapshotId': 'snap1', 'sessionId': 's', 'mode': 'orchestrator', 'purpose': 'analysis', 'question': '判断履约方向并优化补货', 'envelope': env, 'budget': {'maxMarketSearches': 0}}
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'checkpoints.sqlite')) as saver:
            state = await AgentRuntime(saver, model=ScriptedModel()).graph.ainvoke({'job': j}, {'configurable': {'thread_id': j['id']}})
        result = state['result']; assert result['operatingCalculation']['solution']['executionStatus'] == 'draft_only'
        assert result['operatingCalculation']['solution']['cashCents'] == 0
        assert env['operatingPlanning']['problem'] == original
        assert len([r for r in result['toolReads'] if r.get('toolResult', {}).get('solution')]) == 1
    asyncio.run(run())

import asyncio
import json
import httpx
import pytest
from neo_agent import claim_support as support
from neo_agent.execution import ExecutionError, SingleAttemptModel
from neo_agent.model_output import conversation_message
from neo_agent.validation import validate_numeric_prose, numeric_values
from neo_agent.runtime import asserted_optimality
from neo_agent.job_queue import DEFAULT_LIMITS
from neo_agent.task_plan import task_limits
from neo_agent.contracts import RunBudget


def test_full_review_has_time_for_complete_check_but_explicit_deadlines_stay_bounded():
    assert DEFAULT_LIMITS['timeoutSeconds'] == 1800
    assert RunBudget(timeoutSeconds=1800).timeoutSeconds == 1800
    with pytest.raises(ValueError):RunBudget(timeoutSeconds=1801)
    limits = task_limits({'purpose': 'home', 'budget': {'timeoutSeconds': 2}}, DEFAULT_LIMITS)
    assert limits['timeoutSeconds'] == 2 and limits['maxTokens'] is None and limits['maxModelCalls'] is None


def test_semantic_support_disables_thinking_and_keeps_all_output(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'offline-test-key')
    monkeypatch.setenv('LLM_MODEL', 'deepseek-flash')
    monkeypatch.setenv('LLM_BASE_URL', 'https://api.deepseek.com')
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': '{"claims":[]}'}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(respond), **kw))
    message, _ = asyncio.run(SingleAttemptModel().call([{'role': 'system', 'content': 'NEO_SEMANTIC_SUPPORT_CHECK JSON'}]))
    assert message['content'] == '{"claims":[]}'
    assert requests[0]['thinking']['type'] == 'disabled' and 'reasoning_effort' not in requests[0]
    assert 'max_tokens' not in requests[0]


def test_optimality_warning_is_not_a_claim_and_cannot_hide_another_claim():
    warning = '未登记经营目标与约束，不能声称最优方案或收益保证。'
    assert not asserted_optimality({'gaps': [warning], 'conclusion': '先核实退款'})
    assert asserted_optimality({'gaps': [warning], 'conclusion': '这是最优方案'})
    assert asserted_optimality('不能否认这是最优方案')
    assert asserted_optimality('不能否认不能声称最优方案')
    assert asserted_optimality('不能声称最优方案，但该方案收益最大')
    assert not asserted_optimality('方案未登记经营目标与约束，无法据此判定最优或收益最大')
    assert asserted_optimality('不能否认无法据此判定最优或收益最大')
    assert asserted_optimality('无法据此判定最优或收益最大，但另一方案收益最大')
    assert not asserted_optimality('尚不能据此判定方案最优或收益最大')
    assert not asserted_optimality('本批已读资料未见登记，现有资料不足以判定方案最优或收益最大；是否另有登记待核')
    assert asserted_optimality('不能否认现有资料不足以判定方案最优或收益最大')
    assert not support.causal_premise('仅为条件预览，未经因果验证，不代表执行或收益')
    assert not support.causal_premise('系数未经因果验证')
    assert support.causal_premise('系数未经因果验证，但加投导致销量增长')


def test_attribution_window_and_explicit_no_attribution_keep_affirmative_fence():
    for text in ('确认广告归因窗口与对照设计', '下一步先核对退款归属，不做增量归因',
                 '代价是本期不产出任何外部归因结论',
                 '没有对照证据，不能判定费用变化与购买客户回升存在因果'):
        assert not support.causal_premise(text)
    for text in ('广告归因窗口变化造成利润上涨', '不能否认本期不做增量归因',
                 '不做增量归因，但库存不足导致销量下降',
                 '不能否认不能判定费用变化与购买客户回升存在因果'):
        assert support.causal_premise(text)


def test_numeric_repair_receives_all_errors_without_admitting_computed_differences():
    finding = {'conclusion': '费用差额237.5元', 'candidates': ['转化回升15.6个百分点'],
               'gaps': ['费用差额237.5元']}
    with pytest.raises(ValueError) as error:
        validate_numeric_prose(finding, numeric_values({'current': 1187.5, 'previous': 950}), {})
    message = str(error.value)
    assert '237.5元' in message and '15.6' in message and message.count('237.5元') == 1
    validate_numeric_prose({'conclusion': '当前费用1187.5元，此前950元'}, numeric_values({'current': 1187.5, 'previous': 950}), {})


def claim():
    return {'index': 0, 'status': 'supported', 'references': [{'id': 'source', 'quote': '已读原文'}],
            'applicability': '本次冻结资料', 'counterevidence': [], 'gaps': []}


@pytest.mark.parametrize('text', [
    '该周为全期唯一负贡献毛利周，归因未明前不宜加投或补货',
    '周退款归因需回到订单级明细核对',
    '尚不能形成任何政策适用结论',
])
def test_pending_causality_and_policy_applicability_do_not_assert_them(text):
    refs = {'source': {'id': 'source', 'kind': 'paragraph', 'exact': '已读原文', 'applicabilityVerified': False}}
    result = support.validate_claims({'claims': [claim()]}, [{'statement': text, 'statementType': 'assertion'}], refs, {})
    assert result[0]['status'] == 'supported'


@pytest.mark.parametrize('text', [
    '退款归因于渠道费用上涨', '不能否认退款归因于渠道费用上涨',
    '本企业符合该政策', '不能否认本企业符合该政策',
    '不能否认尚不能形成任何政策适用结论',
])
def test_affirmative_or_nested_causality_and_policy_still_require_proof(text):
    refs = {'source': {'id': 'source', 'kind': 'paragraph', 'exact': '已读原文', 'applicabilityVerified': False}}
    with pytest.raises(ExecutionError):
        support.validate_claims({'claims': [claim()]}, [{'statement': text, 'statementType': 'assertion'}], refs, {})


def test_prospective_action_has_no_completed_execution_or_numeric_exemption():
    assert support.statement_type('先取订单级明细再定动作') == 'verification_request'
    assert support.statement_type('先行补齐企业区域与竞品信息') == 'verification_request'
    for text in ('先取退款21件的明细', '先取已完成核验的明细', '先取库存不足导致销量下降的明细'):
        assert support.statement_type(text) == 'assertion'


@pytest.mark.parametrize('tools, mode', [(None, 'enabled'), ([{'type': 'function', 'function': {'name': 'read'}}], 'disabled')])
def test_final_json_uses_thinking_without_changing_tool_call_protocol(monkeypatch, tools, mode):
    monkeypatch.setenv('LLM_API_KEY', 'offline-test-key')
    monkeypatch.setenv('LLM_MODEL', 'deepseek-flash')
    monkeypatch.setenv('LLM_BASE_URL', 'https://api.deepseek.com')
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': '{}'}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(respond), **kw))
    asyncio.run(SingleAttemptModel().call([{'role': 'user', 'content': 'JSON'}], tools))
    assert len(requests) == 1 and requests[0]['thinking']['type'] == mode
    if not tools:
        assert requests[0]['response_format'] == {'type': 'json_object'}


def test_semantic_checker_disables_provider_thinking(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'offline-test-key')
    monkeypatch.setenv('LLM_MODEL', 'deepseek-flash')
    monkeypatch.setenv('LLM_BASE_URL', 'https://api.deepseek.com')
    requests=[]
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'{"claims":[]}'}}]})
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(respond),**kw))
    asyncio.run(SingleAttemptModel().call([{'role':'system','content':'NEO_SEMANTIC_SUPPORT_CHECK v1'},{'role':'user','content':'{}'}]))
    assert requests[0]['thinking']=={'type':'disabled'}


def test_deepseek_thinking_passes_reasoning_content_back_for_every_assistant_turn(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'offline-test-key')
    monkeypatch.setenv('LLM_MODEL', 'deepseek-flash')
    monkeypatch.setenv('LLM_BASE_URL', 'https://api.deepseek.com')
    requests = []
    def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert payload['messages'][1]['reasoning_content'] == ''
        assert payload['messages'][3]['reasoning_content'] == '已核对工具返回。'
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': '{}'}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(respond), **kw))
    messages = [
        {'role': 'user', 'content': '先读取经营资料'},
        {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call-1', 'type': 'function', 'function': {'name': 'read', 'arguments': '{}'}}]},
        {'role': 'tool', 'tool_call_id': 'call-1', 'content': '{}'},
        {'role': 'assistant', 'content': '准备输出', 'reasoning_content': '已核对工具返回。'},
        {'role': 'user', 'content': '输出 JSON'},
    ]
    asyncio.run(SingleAttemptModel().call(messages))
    assert requests[0]['thinking']['type'] == 'enabled'
    assert 'reasoning_content' not in messages[1]


def test_conversation_message_preserves_provider_reasoning_but_drops_receipt_fields():
    message = {'role': 'assistant', 'content': None, 'reasoning_content': '先核对范围。',
               'tool_calls': [{'id': 'call-1'}], '_finish_reason': 'tool_calls'}
    assert conversation_message(message) == {
        'role': 'assistant', 'content': None, 'reasoning_content': '先核对范围。',
        'tool_calls': [{'id': 'call-1'}],
    }


@pytest.mark.parametrize('text', [
    '退款金额、成本冲回与费用构成未拆分，不能把该周负毛利归因于退款',
    '代价是本期不产出外部归因结论',
    '已读取不等于政策适用，也不表示因果已证实',
    '已读原文仅为第三方页面，不表示政策适用',
])
def test_negated_attribution_and_applicability_are_not_positive_claims(text):
    refs = {'source': {'id': 'source', 'kind': 'paragraph', 'exact': '已读原文', 'applicabilityVerified': False}}
    assert not support.causal_premise(text)
    assert support.validate_claims({'claims': [claim()]}, [{'statement': text, 'statementType': 'assertion'}], refs, {})[0]['status'] == 'supported'


@pytest.mark.parametrize('text', [
    '不能否认不能把该周负毛利归因于退款',
    '不能把该周负毛利归因于退款，但库存不足导致销量下降',
    '不能否认不产出外部归因结论',
    '不表示政策适用，但本企业符合该政策',
    '不能否认不表示政策适用',
    '已读取不等于政策适用，但退款造成负毛利',
])
def test_denial_does_not_hide_other_positive_or_nested_claims(text):
    refs = {'source': {'id': 'source', 'kind': 'paragraph', 'exact': '已读原文', 'applicabilityVerified': False}}
    with pytest.raises(ExecutionError):
        support.validate_claims({'claims': [claim()]}, [{'statement': text, 'statementType': 'assertion'}], refs, {})


def test_nested_confirmation_is_a_question_but_asserted_numbers_still_require_support():
    path='draft.finding.homeDecision.jointReview.confirmations.0.question'
    assert support.statement_type('备货目标与安全库存口径是否已确认？',path)=='verification_request'
    assert support.statement_type('库存20件是否已确认？',path)=='assertion'
    assert not support.causal_premise('退款与负毛利同现、因果未证实')
    assert support.causal_premise('退款与负毛利同现、因果未证实，但退款导致负毛利')


def test_catalog_retains_completed_knowledge_result_without_confusing_guidance_or_unread():
    from test_engine import fixture
    state={'job':{'envelope':fixture()},'runtimePlan':{'taskType':'REVIEW'}}
    empty={'items':[],'rules':[],'pack':{'id':'reference','version':'1','title':'参考包'},'gaps':['尚未确认']}
    read={'tool':'read_knowledge','status':'completed','result':empty}
    refs=support.evidence_catalog(state,{'toolReads':[read]})
    assert any(json.loads(r['exact'])==empty for r in refs.values() if r['kind']=='completed_knowledge_read')
    assert not any(r['kind']=='completed_knowledge_read' for r in support.evidence_catalog(state,{'toolReads':[{**read,'status':'failed'}]}).values())


@pytest.mark.parametrize('bad', [False,True])
def test_targeted_prose_repair_preserves_every_other_field_and_rejects_missing_indices(monkeypatch,bad):
    import copy
    import neo_agent.home_semantic_repair as repair
    original={'finding':{'conclusion':'已核对的事实。需要修改的句子', 'evidenceIds':['source'], 'alternatives':[], 'gaps':[], 'candidates':[]},'specialists':{'supply':{'conclusion':'保留供给结果','evidenceIds':['source'],'alternatives':[],'gaps':[],'candidates':[]}},'toolReads':[{'id':'immutable'}],'marketEvidence':[{'id':'original-source'}]}
    before=copy.deepcopy(original)
    monkeypatch.setattr(repair,'evidence_catalog',lambda *args: {})
    class Model:
        async def call(self,messages,tools=None):
            payload=json.loads(messages[1]['content']);assert payload['statements']==['需要修改的句子']
            return {'content':json.dumps({'replacements':[] if bad else [{'index':0,'text':'核对退款原因，再决定动作'}]})},{'total_tokens':1}
    if bad:
        with pytest.raises(ExecutionError):asyncio.run(repair.repair_home_prose({'scope':{}},original,[{'statement':'需要修改的句子'}],Model()))
    else:
        result,usage=asyncio.run(repair.repair_home_prose({'scope':{}},original,[{'statement':'需要修改的句子'}],Model()))
        expected=copy.deepcopy(before);expected['finding']['conclusion']='已核对的事实。核对退款原因，再决定动作'
        assert result==expected and usage[0]['total_tokens']==1
    assert original==before


def test_attribution_denials_keep_outer_negation_and_other_causes_visible():
    for text in ('不能归因为供给或投放问题','不得归因为退款','退款与负毛利的因果关系未证实'):
        assert not support.causal_premise(text)
    for text in ('不能否认不能归因为供给问题','不能归因为供给问题，但库存不足导致销量下降','不能否认因果关系未证实'):
        assert support.causal_premise(text)


def test_repair_lengths_come_from_nested_schema_and_complete_schema_errors_can_repair_once(monkeypatch):
    import neo_agent.home_semantic_repair as repair
    finding={'conclusion':'待核句子','evidenceIds':[],'alternatives':[],'gaps':[],'candidates':[]}
    constraints=repair.replacement_constraints({'finding':finding},['待核句子'])
    assert constraints[0]['maxCharacters']==180
    nested={'finding':{'homeDecision':{'jointReview':{'alternatives':[{'action':'需要修正的短动作'}]},'sections':{'market':{'title':'需要修正的短标题'}}}}}
    assert [c['maxCharacters'] for c in repair.replacement_constraints(nested,['需要修正的短动作','需要修正的短标题'])]==[36,36]
    monkeypatch.setattr(repair,'evidence_catalog',lambda *args: {})
    class Model:
        calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            text='长'*181 if self.calls==1 else '核对退款原因'
            if self.calls==2:assert '结构不合格' in messages[-1]['content']
            return {'content':json.dumps({'replacements':[{'index':0,'text':text}]})},{'total_tokens':1}
    model=Model();result,usages=asyncio.run(repair.repair_home_prose({'scope':{}},{'finding':finding},[{'statement':'待核句子'}],model))
    assert model.calls==2 and len(usages)==2 and result['finding']['conclusion']=='核对退款原因'


def test_pending_confirmation_impact_and_negative_attribution_keep_fact_fences():
    assert support.statement_type('决定可售为零属供给缺口还是登记未完成','draft.finding.homeDecision.jointReview.confirmations.0.why')=='hypothesis'
    assert support.statement_type('决定库存20件是否达标','draft.confirmations.0.impact')=='assertion'
    for text in ('不将外部或历史原因直接归因','无法把库存状态直接归因到渠道'):
        assert not support.causal_premise(text)
    for text in ('不能否认无法把库存状态直接归因到渠道','无法把退款导致负毛利直接归因到渠道','不将外部原因直接归因，但库存不足导致销量下降'):
        assert support.causal_premise(text)
    ref={'id':'read:stock:inventoryPositions','kind':'calculation','exact':json.dumps([{'fact':{'safety_units':10}}])}
    refs={'source':{'id':'source','kind':'paragraph','exact':'已读原文'},ref['id']:ref}
    with pytest.raises(ExecutionError):support.validate_claims({'claims':[claim()]},[{'statement':'无已登记经营目标与安全线','statementType':'assertion'}],refs,{})


def test_readback_denials_and_refund_reason_question_do_not_assert_causality():
    for text in ('退款原因与广告归因字段缺失，同期变化不证明因果',
                 '退款原因、商品与渠道归属未提供，无法归因',
                 '退款原因为何？', '同期不等于因果，缺失不可当零',
                 '当前来源不能解释历史原因，退款原因字段未提供，暂不作为已证实因果',
                 '可售合计40件，需由供给分区确认，此处不归因'):
        assert not support.causal_premise(text)
    for text in ('因为费用上涨导致利润下降', '退款归因于费用上涨',
                 '不能否认无法归因', '不能否认同期不等于因果',
                 '无法归因，但退款导致负毛利', '归因字段缺失导致核算错误',
                 '不能否认暂不作为已证实因果'):
        assert support.causal_premise(text)


def test_pending_causal_identification_does_not_assert_a_completed_relation():
    assert not support.causal_premise('本轮输入未提供已确认经营目标与约束，相关因果待验证')
    assert support.causal_premise('不能否认相关因果待验证')
    assert support.causal_premise('相关因果待验证，但退款导致负毛利')
    assert support.causal_premise('退款归因于费用调整，相关因果待验证')

"""Actual rejected hotel responses, offline protocol evidence only. No provider calls."""
import asyncio,copy,gzip,json
from pathlib import Path
import pytest
from neo_agent.claim_support import check_claim_support,statement_type
from neo_agent.execution import ExecutionError
from neo_agent.operating_reviews import grounded_review
from neo_agent.runtime import canonical_result,frozen_scope,assessment_document
from neo_agent.task_plan import plan_task
from test_unified_runtime import execute

F=json.loads(gzip.decompress((Path(__file__).parent/'fixtures/task4-live-hotel-capacity-replay.json.gz').read_bytes()))
JOB=F['job'];BASIS=JOB['envelope']['operatingBasis']
ORIGINAL=json.loads(json.loads(F['calls'][0]['response'])['content'])

def corrected_review():
    return {'headline':'房型容量待核，预测基线不足','explanation':'历史入住及费用已形成观察毛利；房型容量覆盖不完整，预测基线不足。核对房型可售房晚及停售占用。',
      'claims':[{'metricKey':'contributionMarginCents','value':90000}],
      'evidenceIds':['metric:contributionMarginCents','forecast:'+BASIS['generationId']],
      'hypotheses':[],'alternatives':[],
      'confirmations':[{'question':'请核对入住日房型可售房晚','impact':'预测基线不足','method':'核对房型容量来源与覆盖'}],
      'nextAction':{'title':'核对房型可售房晚','reason':'房型容量覆盖不完整，预测基线不足','condition':'需补充完整房型容量覆盖后再计算预测基线'},
      'limitations':['房型容量覆盖不完整，预测基线不足'],'selectedSourceIds':[]}

def test_actual_original_semantic_verdict_stays_rejected_and_preserves_history_vs_forecast():
    assert F['observed']['status']=='failed' and F['observed']['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
    assert len(F['calls'])==2 and sum(json.loads(c['usage'])['total_tokens'] for c in F['calls'])==10641
    assert BASIS['metrics']['contributionMarginCents']['value']==90000 and BASIS['metrics']['contributionMarginCents']['status']=='complete'
    assert BASIS['baseline']['status']=='insufficient' and BASIS['baseline']['totals']['contributionMarginCents'] is None
    old_review=copy.deepcopy(ORIGINAL)
    old_review['evidenceIds'] += ['metric:'+c['metricKey'] for c in old_review['claims']]
    state={'job':JOB,'scope':frozen_scope(JOB),'reviews':{'joint':old_review},'runtimePlan':F['observed']['result']['runtimePlan']}
    class OriginalChecker:
        async def call(self,messages,tools=None):return json.loads(F['calls'][1]['response']),json.loads(F['calls'][1]['usage'])
    # Reproduce the exact original independent refusal, without a new provider request.
    with pytest.raises(ExecutionError,match='入住与费用指标完整，可算基线收益'):
        draft=canonical_result(state,OriginalChecker());prepared=assessment_document(state,draft)
        public={**draft,**{k:prepared[k] for k in ('problems','hypotheses','candidates','priorityAction','reviewConditions','confirmations','projections')}}
        asyncio.run(check_claim_support(state,public,OriginalChecker()))
    with pytest.raises(ValueError,match='历史经营毛利不是预测基线收益'):
        grounded_review(ORIGINAL,BASIS,[])
    valid=grounded_review(corrected_review(),BASIS,[])
    assert valid['claims']==[{'metricKey':'contributionMarginCents','value':90000}]
    ready=copy.deepcopy(BASIS);ready['baseline'].update(status='calculated',feasibility={'status':'feasible','reasons':[]})
    assert grounded_review(ORIGINAL,ready,[])['claims'][0]['value']==90000

@pytest.mark.parametrize('text',['可算预测基线收益','基线可以计算','漏斗缺口不阻断已入住口径的基线计算'])
def test_incomplete_forecast_rejects_positive_readiness_but_allows_negative_and_historical(text):
    invalid=corrected_review();invalid['explanation']=text
    with pytest.raises(ValueError,match='本轮基线尚不可计算'):grounded_review(invalid,BASIS,[])
    valid=corrected_review();valid['explanation']='历史贡献毛利已观察，不能说可算预测基线收益。'
    assert grounded_review(valid,BASIS,[])['claims'][0]['value']==90000

@pytest.mark.parametrize('question,roles',[
 ('分析以下经营问题：入住与费用完整，房型容量来源缺失。',['supply']),
 ('诊断房型可售房晚与停售维修占用',['supply']),
 ('诊断制造BOM物料短缺和产能',['supply']),
 ('诊断转化退款与库存缺口',['conversion','supply']),
 ('诊断退款毛利',['conversion'])])
def test_hotel_supply_vocabulary_and_other_industry_routing(question,roles):
    job=copy.deepcopy(JOB);job['question']=question
    assert plan_task(job)['selected']==roles


def test_actual_hotel_request_one_finite_repair_then_native_queue_checks_original_scope_and_insufficient_forecast(tmp_path):
    class HotelAdapter:
        name=BASIS['modelIdentity']
        def __init__(self):self.calls=0;self.repairs=0;self.roles=[]
        async def call(self,messages,tools=None):
            self.calls+=1
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                payload=json.loads(messages[1]['content']);references={r.get('id'):r['i'] for r in payload['evidence'] if r.get('id')}
                forecast=references['forecast:'+BASIS['generationId']];margin=references['metric:contributionMarginCents'];lifecycle=references.get('runtime:decision-prerequisites');rows=[]
                for i,text in enumerate(payload['statements']):
                    if payload.get('speechActs',{}).get(str(i))=='V' or statement_type(text)=='verification_request':rows.append({'i':i,'s':'I','r':[forecast],'c':[],'g':['房型容量覆盖待核对']})
                    elif '历史入住及费用已形成观察毛利' in text:rows.append({'i':i,'s':'S','r':[margin],'c':[],'g':[]})
                    elif lifecycle is not None and any(token in text for token in ('本轮建议处于待确认状态','形成长期经验须核验实际执行')):rows.append({'i':i,'s':'S','r':[lifecycle],'c':[],'g':[]})
                    elif '房型容量' in text or '预测基线不足' in text or text in ('供给判断','候选建议，须核对条件','历史统计期不是未来复盘窗口','尚未执行、观察成熟、归因核验并明确确认，不能进入长期经验'):rows.append({'i':i,'s':'S','r':[forecast],'c':[],'g':[]})
                    else:raise AssertionError('Uncovered semantic statement: '+text)
                return {'role':'assistant','content':json.dumps({'claims':rows},ensure_ascii=False)},{'total_tokens':1200}
            assert '历史贡献毛利完整不代表未来baseline可计算' in messages[0]['content']
            if '校验未通过' in messages[-1]['content']:
                self.repairs+=1;assert '历史经营毛利不是预测基线收益' in messages[-1]['content']
            else:
                self.roles.append('supply' if 'NEO的supply' in messages[0]['content'] else 'joint')
            if self.calls==1:return json.loads(F['calls'][0]['response']),json.loads(F['calls'][0]['usage'])
            return {'role':'assistant','content':json.dumps(corrected_review(),ensure_ascii=False)},{'total_tokens':1200}
    model=HotelAdapter();observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert observed['status']=='completed',observed
    assert model.repairs==1 and model.roles==['supply'] and model.calls==3
    limits=observed['observability']['limits'];assert (limits['maxTokens'],limits['maxModelCalls'])==(None,None)
    a=observed['result']['businessAssessment'];assert a['scope']['businessId']==JOB['businessId'] and a['scope']['inputId']==JOB['snapshotId']
    assert a['metrics']['contributionMarginCents']['value']==90000 and a['context']['semanticValidation']['status']=='verified'
    assert '预测基线不足' in observed['result']['finding']['conclusion']
    assert BASIS['baseline']['totals']['contributionMarginCents'] is None


def test_typed_confirmation_questions_methods_and_pending_window_are_not_already_confirmed_facts():
    from neo_agent.claim_support import statements,validate_claims
    draft={'confirmations':[{'question':'确认房型当日可售是多少','method':'按房型核对容量来源','impact':'容量缺失阻断预测基线'}],
      'priorityAction':{'reviewWindow':{'status':'pending_confirmation','reason':'实际执行时间及观察成熟窗口尚待确认'}}}
    items=statements(draft)
    assert {i['statement']:i['statementType'] for i in items}=={'确认房型当日可售是多少':'verification_request','按房型核对容量来源':'verification_request','容量缺失阻断预测基线':'assertion','实际执行时间及观察成熟窗口尚待确认':'verification_request'}
    # Unknown answers and future checks stay pending, including all original text.
    pending=[x for x in items if x['statementType']=='verification_request']
    verdict={'claims':[{'index':i,'status':'insufficient','references':[],'applicability':'原冻结范围','counterevidence':[],'gaps':['尚待核对']} for i in range(len(pending))]}
    claims=validate_claims(verdict,pending,{},frozen_scope(JOB));assert len(claims)==3 and all(not c['definitive'] for c in claims)
    verdict['claims'][0]['status']='contradicted'
    with pytest.raises(ExecutionError,match='矛盾'):validate_claims(verdict,pending,{},frozen_scope(JOB))
    # Same text in an actual assertion context retains the strongest speech act.
    mixed=statements({'finding':{'conclusion':'确认房型当日可售是多少'},'confirmations':draft['confirmations']})
    assert mixed[0]['statementType']=='assertion'

@pytest.mark.parametrize('field,text',[
 ('question','确认退款是库存导致'),('method','核对已执行补货提升30%'),
 ('question','支付三十笔是否因库存导致'),('method','核对已执行补货提升百分之三十'),('method','按房型已完成核对容量来源')])
def test_typed_verification_cannot_hide_numeric_causal_or_executed_presuppositions(field,text):
    from neo_agent.claim_support import statements,validate_claims
    item=statements({'confirmations':[{field:text}]})[0]
    assert item['statementType']=='assertion'
    with pytest.raises(ExecutionError):validate_claims({'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'原冻结范围','counterevidence':[],'gaps':['没有执行/归因/数量证据']}]},[item],{},frozen_scope(JOB))


def test_generic_question_prefix_cannot_override_insufficient_baseline_constraint():
    value=corrected_review();value['confirmations'][0]['question']='确认可算基线收益是否正确'
    with pytest.raises(ValueError,match='本轮基线尚不可计算'):grounded_review(value,BASIS,[])


def public_review(review,full=False):
    """Use the same grounded review and public projections as the runtime gate."""
    review=grounded_review(review,BASIS,[])
    roles=('conversion','supply','market','joint') if full else ('supply',)
    state={'job':JOB,'scope':frozen_scope(JOB),'reviews':{role:copy.deepcopy(review) for role in roles},'runtimePlan':plan_task(JOB)}
    draft=canonical_result(state,None);prepared=assessment_document(state,draft)
    return {**draft,**{k:prepared[k] for k in ('problems','hypotheses','candidates','priorityAction','reviewConditions','confirmations','projections')}}


class BoundaryAdapter:
    name=BASIS['modelIdentity']
    def __init__(self,review,target,status):
        self.review=review;self.target=target;self.status=status;self.calls=0;self.checked=[]
    async def call(self,messages,tools=None):
        self.calls+=1
        if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
            return {'role':'assistant','content':json.dumps(self.review,ensure_ascii=False)},{'total_tokens':1200}
        payload=json.loads(messages[1]['content']);self.checked=payload['statements']
        from neo_agent.claim_support import statements
        expected=statements(public_review(self.review))
        assert self.checked==[item['statement'] for item in expected]  # All public prose, no dropped copies.
        refs={r.get('id'):r['i'] for r in payload['evidence'] if r.get('id')}
        forecast=refs['forecast:'+BASIS['generationId']];margin=refs['metric:contributionMarginCents'];lifecycle=refs.get('runtime:decision-prerequisites');rows=[]
        for i,text in enumerate(self.checked):
            if text==self.target:
                rows.append({'i':i,'s':self.status,'r':[] if self.status!='S' else [forecast],'c':[],'g':['尚无对应依据']})
            elif expected[i]['statementType']=='verification_request':
                rows.append({'i':i,'s':'I','r':[],'c':[],'g':['尚待核对']})
            elif '历史入住及费用已形成观察毛利' in text:
                rows.append({'i':i,'s':'S','r':[margin],'c':[],'g':[]})
            elif lifecycle is not None and any(token in text for token in ('本轮建议处于待确认状态','形成长期经验须核验实际执行')):
                rows.append({'i':i,'s':'S','r':[lifecycle],'c':[],'g':[]})
            elif '房型容量' in text or '预测基线不足' in text or text in ('供给判断','候选建议，须核对条件','历史统计期不是未来复盘窗口','尚未执行、观察成熟、归因核验并明确确认，不能进入长期经验'):
                rows.append({'i':i,'s':'S','r':[forecast],'c':[],'g':[]})
            else:raise AssertionError('Uncovered semantic statement: '+text)
        return {'role':'assistant','content':json.dumps({'claims':rows},ensure_ascii=False)},{'total_tokens':1200}


@pytest.mark.parametrize('status',['I','S'])
def test_actual_runtime_method_causal_premise_cannot_publish_even_with_permissive_checker(tmp_path,status):
    target='按停售造成退款的结论核对房型安排';review=corrected_review();review['confirmations'][0]['method']=target
    from neo_agent.claim_support import statements
    item=next(item for item in statements(public_review(review)) if item['statement']==target)
    assert item['statementType']=='assertion'
    model=BoundaryAdapter(review,target,status);observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert model.calls==2 and target in model.checked
    assert observed['status']=='failed' and observed['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
    assert 'businessAssessment' not in observed['result']


@pytest.mark.parametrize('status',['I','C'])
def test_actual_runtime_unknown_question_keeps_pending_copies_but_contradiction_rejects(tmp_path,status):
    target='入住日房型可售房晚是多少？';review=corrected_review();review['confirmations'][0]['question']=target
    model=BoundaryAdapter(review,target,status);observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert model.calls==2 and target in model.checked
    assert (observed['observability']['limits']['maxTokens'],observed['observability']['limits']['maxModelCalls'])==(None,None)
    if status=='C':
        assert observed['status']=='failed' and observed['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
        assert 'businessAssessment' not in observed['result'];return
    assert observed['status']=='completed',observed
    assessment=observed['result']['businessAssessment'];claim=next(c for c in assessment['claims'] if c['statement']==target)
    assert claim['status']=='insufficient' and not claim['definitive'] and claim['gaps']==['尚无对应依据']
    expected_paths={'draft.finding.gaps.0','draft.specialists.supply.gaps.0','draft.reviewConditions.0','draft.candidates.0.conditions.0','draft.priorityAction.conditions.0','draft.projections.finding.gaps.0','draft.projections.joint.gaps.0','draft.projections.specialists.supply.gaps.0','draft.confirmations.0.question'}
    assert expected_paths.issubset(claim['paths'])
    assert assessment['metrics']['contributionMarginCents']['value']==90000
    assert BASIS['baseline']['status']=='insufficient' and BASIS['baseline']['totals']['contributionMarginCents'] is None


@pytest.mark.parametrize('path',['headline','explanation','impact'])
def test_real_conclusion_or_impact_copy_does_not_inherit_question_speech_act(path):
    from neo_agent.claim_support import statements,validate_claims
    target='入住日房型可售房晚是多少？';review=corrected_review();review['confirmations'][0]['question']=target
    if path in ('headline','explanation'):review[path]=target
    else:review['confirmations'][0][path]=target
    item=next(i for i in statements(public_review(review)) if i['statement']==target)
    assert item['statementType']=='assertion'
    with pytest.raises(ExecutionError,match='语义依据不足'):
        validate_claims({'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'原冻结范围','counterevidence':[],'gaps':['尚待核对']}]},[item],{},frozen_scope(JOB))


@pytest.mark.parametrize('target',['当前没有因果依据','现有资料无因果证据','现有观察不能证明因果','证据仍不支持因果判断','不能证明库存不足导致成交下降','没有证据表明库存不足导致成交下降','不能证明容量不够导致退款','没有证据表明容量不够造成退款'])
def test_actual_grounded_projection_negative_causality_is_not_an_affirmative_causal_claim(tmp_path,target):
    review=corrected_review();review['explanation']=target
    model=BoundaryAdapter(review,target,'S');observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert observed['status']=='completed',observed
    claim=next(c for c in observed['result']['businessAssessment']['claims'] if c['statement']==target)
    assert claim['status']=='supported' and '现有观察没有识别因果' not in claim['gaps']
    assert any(path.endswith('.explanation') for path in claim['paths']) and target in model.checked


@pytest.mark.parametrize('target',[
    '按停售造成退款的结论核对房型安排',
    '按停售引起退款的结论核对房型安排',
    '按退款归因于停售的结论核对房型安排',
    '因为停售而退款增长，按此结论核对房型安排',
    '由于停售而退款增长，按此结论核对房型安排',
    '按不能证明因果但停售造成退款的结论核对房型安排',
    '按无因果证据但退款归因于停售的结论核对房型安排',
    '当前没有因果依据，但库存不足造成成交下降',
    '不能证明库存不足导致成交下降且停售造成退款',
    '不能证明不是库存不足导致成交下降',
    '没有证据表明不是库存不足导致成交下降',
])
def test_actual_method_positive_cause_survives_local_negative_disclaimer_even_with_checker_support(tmp_path,target):
    review=corrected_review();review['confirmations'][0]['method']=target
    model=BoundaryAdapter(review,target,'S');observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert target in model.checked and observed['status']=='failed'
    assert observed['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
    assert 'businessAssessment' not in observed['result']


@pytest.mark.parametrize('target',['并非没有因果证据','不能证明停售不会导致退款','没有因果证据的说法并非事实']+[
    '不能证明'+subject+relation+'退款'
    for subject in ('停售不足以','停售不够','停售不够以','库存不足以','容量不够以')
    for relation in ('导致','造成','引起')
])
@pytest.mark.parametrize('field',['explanation','method'])
def test_actual_projection_nested_denial_remains_assertion_and_rejects_permissive_support(tmp_path,target,field):
    from neo_agent.claim_support import statements
    review=corrected_review()
    if field=='method':target='按'+target+'的结论核对房型安排';review['confirmations'][0]['method']=target
    else:review['explanation']=target
    item=next(i for i in statements(public_review(review)) if i['statement']==target)
    assert item['statementType']=='assertion'
    model=BoundaryAdapter(review,target,'S');observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert target in model.checked and observed['status']=='failed'
    assert observed['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
    assert 'businessAssessment' not in observed['result']


@pytest.mark.parametrize('target',['按当前没有因果依据的说明核对房型安排','按不能证明停售导致退款的说明核对房型安排','按不能证明库存不足导致退款的说明核对房型安排','按不能证明容量不够造成退款的说明核对房型安排'])
def test_actual_method_single_denial_remains_available_without_removing_original_prose(tmp_path,target):
    review=corrected_review();review['confirmations'][0]['method']=target
    model=BoundaryAdapter(review,target,'S');observed,_=execute(tmp_path,copy.deepcopy(JOB),model)
    assert observed['status']=='completed',observed
    assert target in model.checked
    assert any(c['statement']==target for c in observed['result']['businessAssessment']['claims'])


def test_full_review_registered_brief_copies_preserve_pending_question():
    from neo_agent.claim_support import statements
    target='入住日房型可售房晚是多少？';review=corrected_review();review['confirmations'][0]['question']=target
    item=next(i for i in statements(public_review(review,full=True)) if i['statement']==target)
    assert 'draft.projections.brief.nextChecks.0' in item['paths']
    assert item['statementType']=='verification_request'


def test_question_mark_without_typed_origin_does_not_exempt_projected_prose():
    from neo_agent.claim_support import statements
    target='入住日房型可售房晚是多少？'
    items=statements({'finding':{'gaps':[target]},'reviewConditions':[target]})
    assert len(items)==1 and items[0]['statementType']=='assertion'


@pytest.mark.parametrize('text',['核对已执行补货是否改善房型安排？','按已完成停售核验的结果确认房型安排'])
def test_actual_projection_completed_execution_in_method_remains_assertion(text):
    from neo_agent.claim_support import statements,validate_claims
    review=corrected_review();review['confirmations'][0]['method']=text
    item=next(i for i in statements(public_review(review)) if i['statement']==text)
    assert item['statementType']=='assertion'
    with pytest.raises(ExecutionError,match='语义依据不足'):
        validate_claims({'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'原冻结范围','counterevidence':[],'gaps':['未执行']}]},[item],{},frozen_scope(JOB))


@pytest.mark.parametrize('field,text',[('question','支付三十笔是否为停售造成？'),('method','核对退款30笔是否为停售造成？')])
def test_actual_grounded_projection_cannot_admit_numeric_question_or_method(field,text):
    review=corrected_review();review['confirmations'][0][field]=text
    with pytest.raises(ValueError,match='数字|数量'):public_review(review)

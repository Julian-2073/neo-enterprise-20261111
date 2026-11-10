"""Regression coverage for failed live homepage semantic checks."""
import copy,json,asyncio
import pytest
import neo_agent.claim_support as support
from neo_agent.execution import ExecutionError
from neo_agent.validation import validate_numeric_prose

def test_chinese_calendar_dates_are_not_business_counts_but_quantities_stay_checked():
    validate_numeric_prose({'gaps':['2026年9月21日东仓到货是否已计入2026年9月24日可售待核','核对2026年8月24日至9月20日的退款归属','资料于2026年10月读取']},set(),{})
    for text in ('2026年2月31日到货','2026年13月读取','提前2026年备货','周期9个月','销量2026件','9月21日到货40件'):
        with pytest.raises(ValueError):validate_numeric_prose({'gaps':[text]},set(),{})

def test_causal_method_names_and_single_denials_are_not_affirmative_causal_claims():
    for text in ('核对渠道费用归因口径','核实广告归因参数','内部数据不证明因果','现有观察不能直接归因','退款与费用归因尚未核实','先核退款归因与费用归因口径','购买增加不与退款直接归因'):
        assert not support.causal_premise(text)
    for text in ('核对库存不足导致销量下降','因渠道费用归因口径变化导致利润上涨','不能否认内部数据不证明因果'):
        assert support.causal_premise(text)
    for text in ('先核退款与费用口径','待核对到货上架状态','转化与市场口径核实前不下结论'):
        assert support.statement_type(text)=='verification_request'
    assert support.statement_type('先核退款21件的来源')=='assertion'
    assert support.statement_type('可能改变经营判断','draft.confirmations.0.impact')=='hypothesis'
    assert support.statement_type('可能改变经营判断','draft.finding.conclusion')=='assertion'

def test_completed_rejected_verdict_gets_one_bound_reconsideration_without_weakening_gate(monkeypatch):
    refs={'record':{'id':'record','kind':'metric','exact':'{"refundUnits":7}'}}
    monkeypatch.setattr(support,'evidence_catalog',lambda *a:refs)
    monkeypatch.setattr(support,'business_evidence_guide',lambda *a:[{'i':0,'field':'totals','rows':[{'refundUnits':7}]}])
    draft={'finding':{'conclusion':'核对退款7件的归属'}};calls=[]
    class Checker:
        second='S'
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);calls.append(p)
            assert p['evidence'][0]['data']=={'refundUnits':7}
            if len(calls)==2:assert p['previousVerdicts'][0]['statement']==p['statements'][0]
            s='I' if len(calls)==1 else self.second
            return {'content':json.dumps({'claims':[{'i':0,'s':s,'r':[0],'c':[0] if s=='C' else [],'g':['归属待核']}]})},{}
    model=Checker();state={'scope':{},'job':{'purpose':'home'}}
    claims,_=asyncio.run(support.check_claim_support(state,draft,model))
    assert len(calls)==2 and claims[0]['status']=='supported'
    calls.clear();model.second='C'
    with pytest.raises(ExecutionError):asyncio.run(support.check_claim_support(state,draft,model))
    assert len(calls)==2

def test_pending_provider_status_never_promotes_an_unverified_assertion():
    catalog={'record':{'id':'record','kind':'metric','exact':'{"value":40}'}}
    raw={'claims':[{'i':0,'s':'V','r':[0],'c':[],'g':['仍需核实上架']}]}
    decoded,resolved=support.decode_compact_claims(raw,catalog,{},1)
    assert decoded['claims'][0]['status']=='insufficient'
    pending={'statement':'核实到货是否已上架','statementType':'verification_request'}
    claims=support.validate_claims(decoded,[pending],resolved,{})
    assert claims[0]['status']=='insufficient' and not claims[0]['definitive']
    with pytest.raises(ExecutionError,match='语义依据不足'):
        support.validate_claims(decoded,[{'statement':'货物已经上架','statementType':'assertion'}],resolved,{})
    with pytest.raises(ValueError,match='状态'):
        support.decode_compact_claims({'claims':[{**raw['claims'][0],'s':'unrecognized'}]},catalog,{},1)

def test_business_guide_binds_plain_sku_rows_and_money_to_unchanged_exact_evidence():
    original={'rows':{'id':'rows','kind':'calculation','scope':{'inventoryAsOf':'2026-09-24'},'exact':json.dumps([{'id':'audit-1','availableAt':'2026-10-04','fact':{'sku_id':'sim-M1-S1','warehouse_id':'sim-W-east','sellable_units':0,'in_transit_units':0,'business_date':'2026-09-24'}}])},
              'read:abc:weeklyTotals':{'id':'read:abc:weeklyTotals','kind':'calculation','scope':{'periodStart':'2026-08-24','periodEnd':'2026-08-30'},'exact':json.dumps([{'weekStart':'2026-08-24','paidOrders':None,'refundUnits':7,'contributionMarginCents':-1482035,'metricStatus':{'paidOrders':{'status':'missing'},'refundUnits':{'status':'observed'}}}])}}
    original['read:abc:inventoryPositions']=original.pop('rows');original['read:abc:inventoryPositions']['id']='read:abc:inventoryPositions'
    before=copy.deepcopy(original);guide=support.business_evidence_guide(original)
    inventory=next(r for r in guide if r['field']=='inventoryPositions')
    assert inventory['rows'][0]['sku_id']=='sim-M1-S1' and inventory['rows'][0]['sellable_units']==0
    assert inventory['rows'][0]['availableAt']=='2026-10-04' and inventory['scope']['inventoryAsOf']=='2026-09-24'
    finance=next(r for r in guide if r['field']=='weeklyTotals')
    assert finance['rows'][0]['contributionMarginYuan']==-14820.35
    assert finance['rows'][0]['paidOrders'] is None and finance['rows'][0]['metricStatus']['paidOrders']['status']=='missing'
    assert list(original)[finance['i']]=='read:abc:weeklyTotals' and original==before

def test_long_review_uses_canonical_statement_kinds_and_places_task_after_full_evidence(monkeypatch):
    refs={'counter':{'id':'counter','kind':'paragraph','exact':'完整反证，必须保留。'}}
    monkeypatch.setattr(support,'evidence_catalog',lambda *a:refs)
    draft={'finding':{'candidates':['核对经营条件'+chr(0x4e00+i) for i in range(60)]}}
    class Checker:
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);keys=list(p)
            assert keys.index('evidence')<keys.index('statements') and p['evidence'][0]['exact']==refs['counter']['exact']
            assert 'speechActs' not in p and p['statementKinds']==['verification_request']*len(p['statements'])
            return {'content':json.dumps({'claims':[{'i':i,'s':'V','r':[],'c':[],'g':['待核经营条件']} for i in range(len(p['statements']))]})},{}
    claims,_=asyncio.run(support.check_claim_support({'scope':{}},draft,Checker()))
    assert len(claims)==60 and all(c['status']=='insufficient' and not c['definitive'] for c in claims)

def test_complete_review_reports_every_rejected_claim_without_publishing_partial_claims(monkeypatch):
    refs={'record':{'id':'record','kind':'metric','exact':'{"value":40}'}}
    monkeypatch.setattr(support,'evidence_catalog',lambda *a:refs)
    draft={'finding':{'gaps':['缺少资料'+chr(0x4e00+i) for i in range(60)]}}
    calls=[]
    class Checker:
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);calls.append(p)
            return {'content':json.dumps({'claims':[{'i':i,'s':'I','r':[],'c':[],'g':['未绑定依据']} for i in range(len(p['statements']))]})},{}
    with pytest.raises(ExecutionError) as error:asyncio.run(support.check_claim_support({'scope':{},'job':{'purpose':'home'}},draft,Checker()))
    assert error.value.code=='CLAIM_NOT_SUPPORTED'
    assert len(calls)==3 and len(error.value.claim_issues)==60
    assert [i['statement'] for i in error.value.claim_issues]==draft['finding']['gaps']
    assert all(i['paths'] and i['gaps']==['未绑定依据'] for i in error.value.claim_issues)

def test_missing_verdicts_are_checked_without_repeating_accepted_rows(monkeypatch):
    refs={'record':{'id':'record','kind':'metric','exact':'{"value":40}'}}
    monkeypatch.setattr(support,'evidence_catalog',lambda *a:refs);calls=[]
    draft={'finding':{'gaps':['资料甲','资料乙','资料丙']}}
    class Checker:
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);calls.append(p)
            if len(calls)==1:return {'content':json.dumps({'claims':[{'i':0,'s':'S','r':0,'c':[],'g':[]}]})},{}
            assert p['statements']==['资料乙','资料丙']
            return {'content':json.dumps({'claims':[{'i':i,'s':'S','r':0,'c':[],'g':[]} for i in range(2)]})},{}
    claims,_=asyncio.run(support.check_claim_support({'scope':{}},draft,Checker()))
    assert len(calls)==2 and [c['statement'] for c in claims]==draft['finding']['gaps']
    assert all(c['supportingReferences']==[refs['record']] for c in claims)

def test_long_gap_is_split_losslessly_without_changing_verdict_or_references(monkeypatch):
    refs={'record':{'id':'record','kind':'metric','exact':'{"value":40}'}}
    monkeypatch.setattr(support,'evidence_catalog',lambda *a:refs);reason='未确认的上架状态与来源限制。'*30
    class Checker:
        async def call(self,*a,**k):return {'content':json.dumps({'claims':[{'i':0,'s':'I','r':[0],'c':[],'g':[reason]}]})},{}
    claims,_=asyncio.run(support.check_claim_support({'scope':{}},{'finding':{'candidates':['核实上架状态']}},Checker()))
    assert claims[0]['status']=='insufficient' and ''.join(claims[0]['gaps'])==reason
    assert all(len(g)<=120 for g in claims[0]['gaps']) and claims[0]['supportingReferences']==[refs['record']]
    with pytest.raises(ExecutionError):asyncio.run(support.check_claim_support({'scope':{}},{'finding':{'conclusion':'货物已经上架'}},Checker()))

def test_home_repairs_only_rejected_professional_and_rechecks_all_sources(monkeypatch):
    import neo_agent.runtime as runtime
    from types import SimpleNamespace
    state={'job':{'purpose':'home','envelope':{}},'scope':{'sourceKind':'snapshot','inputId':'frozen'},'runtimePlan':{'requiredRoles':['conversion','supply']},'selected':['conversion','supply'],'findings':{'conversion':{'conclusion':'保留客户审查'},'supply':{'conclusion':'把历史退款误称最近周'}},'toolReads':[],'evidence':[],'draft':{'finding':{'conclusion':'原综合判断'},'specialists':{'conversion':{'conclusion':'保留客户审查'},'supply':{'conclusion':'把历史退款误称最近周'}},'usage':[],'toolReads':[]}}
    original=copy.deepcopy(state);calls=[];checked=[]
    def assessment(*a):return {k:[] for k in ('problems','hypotheses','candidates','priorityAction','reviewConditions','confirmations','projections')}
    async def check(s,d,model):
        checked.append(copy.deepcopy(d))
        if len(checked)==1:
            error=ExecutionError('历史周不是最近周','CLAIM_NOT_SUPPORTED');error.claim_issues=[{'statement':'把历史退款误称最近周','paths':['draft.specialists.supply.conclusion'],'gaps':['日期不符']}];error.usage=[{'total_tokens':2}];raise error
        assert d['specialists']['supply']['conclusion']=='历史周退款待核原因'
        return [{'status':'supported'}],[{'total_tokens':3}]
    async def repair(s,draft,issues,model):
        calls.append('rejected-prose');assert s['scope']==original['scope']
        assert issues[0]['statement']=='把历史退款误称最近周'
        corrected=copy.deepcopy(draft);corrected['specialists']['supply']['conclusion']='历史周退款待核原因'
        return corrected,[{'total_tokens':4}]
    async def emit(*a):pass
    monkeypatch.setattr(runtime,'assessment_document',assessment);monkeypatch.setattr(runtime,'check_claim_support',check)
    import neo_agent.home_semantic_repair as prose_repair
    monkeypatch.setattr(prose_repair,'repair_home_prose',repair)
    service=runtime.NeoRuntime.__new__(runtime.NeoRuntime);service.model=object();service.legacy=SimpleNamespace(emit=emit)
    result=asyncio.run(service.validate(state))
    assert calls==['rejected-prose'] and len(checked)==2 and state==original
    assert result['findings']==result['draft']['specialists'] and result['findings']['conversion']==original['findings']['conversion']
    assert result['draft']['usage']==[{'total_tokens':2},{'total_tokens':4},{'total_tokens':3}]

def test_prepared_professional_reuses_its_full_read_and_actual_citation_without_failed_tools():
    from test_engine import fixture
    from neo_agent.agent import AgentRuntime
    from neo_agent.contracts import Job
    from neo_agent.task_plan import plan_task
    from neo_agent.runtime import frozen_scope
    from neo_agent.business_tools import read_fact_view
    env=fixture();home=Job(id='prepared',businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='s',mode='orchestrator',purpose='home',question='完整经营核查',envelope=env).model_dump(mode='json')
    job={**home,'purpose':'review','mode':'conversion'};reads=[]
    for section in ('conversion','supply','market'):
        args={'section':section,'grain':'period'};out=read_fact_view(env,section,args)
        reads.append({'tool':'read_business','status':'completed','arguments':args,'queryEvidence':out['queryEvidence'],'evidenceIds':['ev1']})
    state={'job':job,'runtimePlan':plan_task(home),'scope':frozen_scope(home),'runtimePrepared':True,'toolReads':reads,'evidence':[],'findings':{},'calculationContext':{},'diagnostics':{}}
    calls=[]
    class Model:
        async def call(self,messages,tools=None):
            calls.append(messages);assert tools is None and not any(m['role']=='tool' for m in messages)
            references=json.loads(messages[0]['content'].split('复用检查点的实际可引用编号：')[1].split('。只能')[0])
            short=references[0]['ref']
            finding={'conclusion':'核实退款来源。','evidenceIds':[short],'alternatives':[],'gaps':[],'candidates':[],'followups':[],'businessReview':{'title':'退款来源待核','summary':'核实退款来源后再判断承接。','evidenceIds':[short]}}
            return {'role':'assistant','content':json.dumps(finding)},{}
    service=AgentRuntime(None,model=Model(),build_graph=False)
    finding,_,_,new_reads=asyncio.run(service.specialist(state,'conversion'))
    assert len(calls)==1 and new_reads==[] and finding['businessReview']['evidenceIds']==['ev1']

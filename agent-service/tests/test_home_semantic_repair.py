"""A completed homepage verdict can repair prose, never bypass verification."""
import asyncio,copy,json
from types import SimpleNamespace
import pytest
import neo_agent.runtime as runtime
import neo_agent.home_semantic_repair as prose_repair
from neo_agent.execution import ExecutionError

@pytest.mark.parametrize('second_failure',[False,True])
@pytest.mark.parametrize('purpose,task',[('home','REVIEW'),('analysis','SIMULATE')])
def test_home_repair_retains_scope_professionals_and_rechecks_entire_public_result(monkeypatch,second_failure,purpose,task):
    state={'job':{'purpose':'home','envelope':{}},'scope':{'sourceKind':'snapshot','inputId':'frozen'},'runtimePlan':{'requiredRoles':['conversion','supply','market']},'selected':['conversion','supply','market'],'findings':{'conversion':{'conclusion':'已核对转化'},'supply':{'conclusion':'已核对供给'},'market':{'conclusion':'已核对渠道'}},'draft':{'finding':{'conclusion':'缺少依据的优先级断言'},'specialists':{'supply':{'conclusion':'保留专业反证'}},'usage':[],'toolReads':[{'id':'original'}]}}
    state['job']['purpose']=purpose;state['runtimePlan']['taskType']=task
    if task=='SIMULATE':state['draft']['finding']['proposedAssumptions']={'adjustments':[],'extraCostCents':10000}
    original=copy.deepcopy(state);verified=[];repairs=[]
    def assessment(s,d):return {**{k:[] for k in ('problems','hypotheses','candidates','reviewConditions','confirmations')},'priorityAction':None,'projections':{'finding':d['finding'],'specialists':d['specialists']},'verified':bool(s['claims'])}
    async def check(s,d,model):
        verified.append(copy.deepcopy(d));assert s==original
        if len(verified)==1 or second_failure:raise ExecutionError('语义依据不足：优先级断言','CLAIM_NOT_SUPPORTED')
        return [{'status':'supported'}],[{'total_tokens':10}]
    async def specialist(s,draft,issues,model):
        repairs.append((s,draft,issues));assert s['scope']==state['scope'] and s['findings']==state['findings']
        return {**draft,'finding':{**draft['finding'],'conclusion':'建议先核对条件，再决定调整'}},[{'total_tokens':20}]
    async def emit(*args):pass
    monkeypatch.setattr(runtime,'assessment_document',assessment);monkeypatch.setattr(runtime,'check_claim_support',check)
    monkeypatch.setattr(prose_repair,'repair_home_prose',specialist)
    service=runtime.NeoRuntime.__new__(runtime.NeoRuntime);service.model=object();service.legacy=SimpleNamespace(emit=emit)
    if second_failure:
        with pytest.raises(ExecutionError,match='语义依据不足') as failure:asyncio.run(service.validate(state))
        assert failure.value.recovery_draft['finding']['conclusion']=='建议先核对条件，再决定调整'
        assert 'assessment' not in failure.value.recovery_draft
    else:
        result=asyncio.run(service.validate(state));assert result['assessment']['verified']
        assert result['draft']['toolReads']==[{'id':'original'}]
        assert result['draft']['usage']==[{'total_tokens':20},{'total_tokens':10}]
    assert len(repairs)==(2 if second_failure else 1) and len(verified)==(3 if second_failure else 2) and state==original
    assert verified[0]['specialists']==verified[1]['specialists']==state['draft']['specialists']
    assert verified[1]['finding']['conclusion']=='建议先核对条件，再决定调整'

@pytest.mark.parametrize('code,purpose',[('MODEL_CALL_UNCERTAIN','home'),('CLAIM_VALIDATION_FAILED','home'),('CLAIM_NOT_SUPPORTED','analysis')])
def test_unknown_calls_format_failures_and_nonhome_jobs_never_trigger_content_repair(monkeypatch,code,purpose):
    async def check(*args):raise ExecutionError('stop',code)
    def assessment(*args):return {k:[] for k in ('problems','hypotheses','candidates','priorityAction','reviewConditions','confirmations','projections')}
    async def forbidden(*args):pytest.fail('must not issue a repair call')
    monkeypatch.setattr(runtime,'assessment_document',assessment);monkeypatch.setattr(runtime,'check_claim_support',check)
    service=runtime.NeoRuntime.__new__(runtime.NeoRuntime);service.model=object();service.legacy=SimpleNamespace(specialist=forbidden,emit=forbidden)
    state={'job':{'purpose':purpose,'envelope':{}},'scope':{'sourceKind':'snapshot'},'runtimePlan':{'requiredRoles':[]},'selected':[],'draft':{}}
    with pytest.raises(ExecutionError) as e:asyncio.run(service.validate(state))
    assert e.value.code==code


@pytest.mark.parametrize('unsafe',[False,True])
def test_repaired_checkpoint_stays_unpublished_and_unknown_calls_are_never_replayed(tmp_path,unsafe):
    from neo_agent.runner import preserve_repaired_draft
    from neo_agent.job_queue import JobQueue
    job={'id':'checkpoint','snapshotId':'frozen'};draft={'finding':{'conclusion':'已完成但尚未通过核对的修正'}}
    q=JobQueue(tmp_path/'jobs.sqlite');q.initialize();updates=[]
    if unsafe:
        with q.db() as c:c.execute("INSERT INTO model_calls(job_id,call_key,state) VALUES('checkpoint','uncertain','uncertain')")
    class Graph:
        async def aget_state(self,config):return SimpleNamespace(values={'job':job,'draft':{}},next=('validation',))
        async def aupdate_state(self,config,value,as_node):updates.append((value,as_node))
    result=asyncio.run(preserve_repaired_draft(SimpleNamespace(graph=Graph()),{},q,'checkpoint',job,draft))
    assert result is (not unsafe)
    if unsafe:assert updates==[]
    else:
        assert updates==[({'draft':draft},'synthesis')]
        with q.db() as c:event=json.loads(c.execute('SELECT payload FROM run_events').fetchone()[0])
        assert event['semanticStatus']=='unverified' and event['next']=='validation'


def test_prose_replacement_cannot_change_user_scenario_parameters_or_provenance():
    assumptions={'adjustments':[],'arrivals':[],'transfers':[],'extraCostCents':10000,'extraCostAssumption':{'source':'user_assumption','confirmed':False,'note':'用户假设期间额外费用100元'}}
    finding={'conclusion':'待核结论','evidenceIds':['read'],'alternatives':[],'gaps':[],'candidates':[],'proposedAssumptions':assumptions}
    draft={'finding':finding,'specialists':{},'toolReads':[{'id':'completed-read'}]}
    original=copy.deepcopy(draft)
    corrected=prose_repair.apply_replacements(draft,['待核结论'],{'replacements':[{'index':0,'text':'请预览并核对条件，再重新推演'}]})
    assert corrected['finding']['proposedAssumptions']==assumptions
    assert corrected['toolReads']==draft['toolReads'] and draft==original
    with pytest.raises(ValueError,match='未定位'):
        prose_repair.apply_replacements(draft,[assumptions['extraCostAssumption']['note']],{'replacements':[{'index':0,'text':'已经确认费用'}]})

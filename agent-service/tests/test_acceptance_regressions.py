"""Local acceptance regressions on the existing frozen synthetic input."""
import asyncio,copy,gzip,json
from pathlib import Path
import pytest
from neo_agent.agent import AgentRuntime
from neo_agent.runtime import NeoRuntime
from neo_agent.execution import ExecutionError
from neo_agent.ontology import expand_ontology
from neo_agent.task_plan import plan_task
from test_unified_runtime import execute

F=Path(__file__).parent/'fixtures'
def recorded_job(question,mode):
    job=json.loads(gzip.decompress((F/'task4-live-legacy-query.json.gz').read_bytes()))
    job.update(id='acceptance-regression',question=question,mode=mode)
    job.pop('taskType',None)
    return job

class NoModel:
    name='offline-no-model'
    async def call(self,*args,**kwargs):raise AssertionError('Literal frozen metric queries must not call a provider')

@pytest.mark.parametrize('text,allowed',[
    ('限制：本轮内容只是条件推演草案，未执行，也不保证收益',True),
    ('不能保证实际收益',True),
    ('不保证收益，但保证利润增长',False),
    ('并非不保证收益',False),
    ('不能说不保证收益',False),
    ('保证收益',False),
    ('不保证收益不会下降',False),
])
def test_single_outcome_disclaimer_is_not_a_positive_guarantee(text,allowed):
    from neo_agent.claim_support import validate_claims
    ref={'id':'boundary','kind':'runtime_boundary','exact':'本轮为只读条件草案'}
    verdict={'claims':[{'index':0,'status':'supported','references':[{'id':'boundary','quote':ref['exact']}],'applicability':'本轮只读草案','counterevidence':[],'gaps':[]}]}
    items=[{'statement':text,'statementType':'assertion'}]
    if allowed:
        assert validate_claims(verdict,items,{'boundary':ref},{})[0]['status']=='supported'
    else:
        with pytest.raises(ExecutionError):validate_claims(verdict,items,{'boundary':ref},{})

@pytest.mark.parametrize('text,allowed',[
    ('请确认这100元费用属于哪个科目、在哪天发生、由哪一环节承担，以便核对费用归属口径',True),
    ('请确认这100元费用的归属商品与渠道、发生日期',True),
    ('请确认这100元费用已经支付',False),
    ('请确认这100元费用导致销量增长',False),
    ('请确认这100元费用的归属商品与渠道，我据此把它落到具体行重算',False),
    ('请确认净成交额100元',False),
])
def test_expense_attribute_questions_do_not_claim_the_unknown_answer(text,allowed):
    from neo_agent.claim_support import validate_claims
    verdict={'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'本轮费用口径待确认','counterevidence':[],'gaps':['费用归属尚未提供']}]}
    items=[{'statement':text,'statementType':'assertion'}]
    if allowed:
        row=validate_claims(verdict,items,{}, {})[0]
        assert not row['definitive'] and row['statementType']=='verification_request'
        verdict['claims'][0]['status']='contradicted'
        with pytest.raises(ExecutionError):validate_claims(verdict,items,{}, {})
    else:
        with pytest.raises(ExecutionError):validate_claims(verdict,items,{}, {})

@pytest.mark.parametrize('text,allowed',[
    ('2026-09-25至2026-10-22的28天窗口待核对，需求、价格、到货、调拨不变',True),
    ('2026-09-25至2026-10-22的28天窗口已确认',False),
    ('2026-09-25至2026-10-22的30天窗口待核对',False),
    ('2026-09-25至2026-10-22的28天窗口待核对，保证收益最大',False),
    ('2026-10-25至2026-11-21的28天窗口待核对',False),
])
def test_pending_forecast_window_remains_unconfirmed_rather_than_a_published_fact(text,allowed):
    from neo_agent.claim_support import validate_claims
    verdict={'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'本轮条件草案','counterevidence':[],'gaps':['起止日期待确认']}]}
    items=[{'statement':text,'statementType':'assertion'}];scope={'asOf':'2026-09-24'}
    if allowed:
        row=validate_claims(verdict,items,{},scope)[0]
        assert row['statementType']=='hypothesis' and not row['definitive'] and row['status']=='insufficient'
        verdict['claims'][0]['status']='contradicted'
        with pytest.raises(ExecutionError):validate_claims(verdict,items,{},scope)
    else:
        with pytest.raises(ExecutionError):validate_claims(verdict,items,{},scope)

@pytest.mark.parametrize('status',['I','C'])
def test_pending_window_is_presented_consistently_to_the_checker(monkeypatch,status):
    import neo_agent.claim_support as support
    monkeypatch.setattr(support,'evidence_catalog',lambda *args:{})
    text='2026-09-25至2026-10-22的28天窗口待核对，需求、价格、到货、调拨不变'
    class RecordedChecker:
        async def call(self,messages,tools=None):
            payload=json.loads(messages[1]['content'])
            assert payload['statements']==[text]
            assert payload.get('speechActs')=={'0':'V'}
            return {'content':json.dumps({'claims':[{'i':0,'s':status,'r':[],'c':[],'g':['日期未确认']}]})},{}
    check=support.check_claim_support({'scope':{'asOf':'2026-09-24'}},{'finding':{'conclusion':text}},RecordedChecker())
    if status=='C':
        with pytest.raises(ExecutionError,match='矛盾'):asyncio.run(check)
    else:
        claims,_=asyncio.run(check)
        assert claims[0]['statementType']=='hypothesis'
        assert claims[0]['status']=='insufficient' and not claims[0]['definitive']

@pytest.mark.parametrize('question,mode,expected',[
    ('请核对一下库存量。','supply','可售40件'),
    ('帮我核对收入','market','750994.20元'),
    ('核对毛利','market','257384.20元'),
])
def test_frozen_metric_queries_publish_exact_records_without_generation(tmp_path,question,mode,expected):
    result,_=execute(tmp_path,recorded_job(question,mode),NoModel())
    assert result['status']=='completed',result.get('error')
    assert expected in result['result']['finding']['conclusion']
    assert result['observability']['modelInvocations']==0
    assert result['result']['businessAssessment']['context']['semanticValidation']['status']=='verified'

@pytest.mark.parametrize('question', ['为什么库存减少','如果收入增加20%','核对上周收入','核对收入和退款笔数','库存与到货日期是否一致','不要核对毛利'])
def test_metric_selector_never_absorbs_other_scopes_or_analysis(question):
    from neo_agent.agent import deterministic_fact_answer
    job=recorded_job(question,'market')
    env=expand_ontology(job['envelope'])
    assert deterministic_fact_answer(env,'market',question,plan_task(job)['taskType']) is None


def test_orchestrator_prompt_resolves_assumption_schema_references():
    job=recorded_job('请预览一个仅额外成本增加100元的经营方案草案','orchestrator')
    seen=[]
    class Capture:
        async def call(self,messages,tools=None):
            system=messages[0]['content'];marker='最终严格JSON：';schema=json.JSONDecoder().raw_decode(system.split(marker)[1])[0]
            def visit(value):
                if isinstance(value,dict):
                    if '$ref' in value:assert value['$ref'].split('/')[-1] in schema.get('$defs',{}),value
                    for child in value.values():visit(child)
                elif isinstance(value,list):
                    for child in value:visit(child)
            visit(schema);seen.append(schema);raise ExecutionError('bounded capture','OFFLINE_CAPTURE')
    state={'job':job,'runtimePlan':plan_task(job),'findings':{},'evidence':[]}
    with pytest.raises(ExecutionError,match='bounded capture'):asyncio.run(AgentRuntime(None,model=Capture(),build_graph=False).specialist(state,'orchestrator'))
    assert seen


def test_saved_scenario_read_is_compact_and_citable_only_in_its_frozen_scope():
    job=recorded_job('请预览一个仅额外成本增加100元的经营方案草案','orchestrator')
    env=expand_ontology(job['envelope']);scope={k:job[k] for k in ('businessId','dataNature','snapshotId')}
    context={'findings':[],'forecasts':[], 'scenarios':[{'id':'saved-scenario',**scope,'title':'已有条件试算','totals':{'units':35},'weeks':[{'sourceDetails':'x'*1000} for _ in range(100)],'assumptions':{'extraCostCents':10000},'limitations':['条件推演，不是实际收益']},{'id':'foreign-scenario',**scope,'businessId':'other','totals':{'units':999}}], 'decisions':[], 'marketEvidence':[]}
    env['decisionContext']=context;job['envelope']=env;seen=[]
    class SavedRecordModel:
        async def call(self,messages,tools=None):
            if not any(m.get('role')=='tool' for m in messages):
                return {'role':'assistant','tool_calls':[{'id':name,'type':'function','function':{'name':name,'arguments':json.dumps(args)}} for name,args in [('describe_business',{}),('read_business',{'section':'market'}),('read_decisions',{'section':'summary'})]]},{}
            read=next(m for m in messages if m.get('tool_call_id')=='read_decisions')
            wire=read['content'];seen.append(wire)
            assert len(wire)<12000,'saved details must not flood the dialogue'
            assert 'foreign-scenario' not in wire
            finding={'conclusion':'当前已有条件试算，仍需核对成立条件。','basis':[],'nextStep':None,'evidenceIds':['saved-scenario'],'alternatives':[],'gaps':[],'candidates':[],'followups':[]}
            return {'role':'assistant','content':json.dumps(finding,ensure_ascii=False)},{}
    state={'job':job,'runtimePlan':plan_task(job),'findings':{},'evidence':[],'calculationContext':{}}
    finding,_,_,reads=asyncio.run(AgentRuntime(None,model=SavedRecordModel(),build_graph=False).specialist(state,'orchestrator'))
    assert finding['evidenceIds']==['saved-scenario']
    assert any('saved-scenario' in read.get('evidenceIds',[]) for read in reads)
    assert all('foreign-scenario' not in read.get('evidenceIds',[]) for read in reads)
    from neo_agent.claim_support import evidence_catalog
    state.update(scope={'sourceKind':'snapshot','businessId':job['businessId'],'dataNature':job['dataNature'],'inputId':job['snapshotId']},diagnostics={})
    catalog=evidence_catalog(state,{'finding':finding,'toolReads':reads})
    assert catalog['saved-scenario']['kind']=='saved_scenario'
    assert '条件推演' in catalog['saved-scenario']['exact']
    assert 'foreign-scenario' not in catalog

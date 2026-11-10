import asyncio,json,copy,gzip,base64
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.contracts import Job
from neo_agent.engine import source_hash
from neo_agent.job_queue import JobQueue,DEFAULT_LIMITS
from neo_agent.runner import run_once
from neo_agent.runtime import frozen_scope
from neo_agent.task_plan import plan_task,task_limits
from test_engine import fixture
from test_agents import MockModel
from test_operating_reviews import basis,answer,Model as OperatingModel

def job(source='snapshot',question='只核对支付订单',mode='conversion',**changes):
    env=fixture() if source=='snapshot' else {'snapshot':{'id':'g','businessId':'b1','dataNature':'demo','asOf':'2026-09-30'},'operatingBasis':{**basis(),'businessId':'b1','dataNature':'demo','operatingVersion':'operating-v1','configuration':{'id':'config-one'},'interaction':{'question':question,'role':mode}}}
    s=env['snapshot'];env['runtimeScope']={'businessId':'b1','dataNature':'demo','inputId':s['id'],'asOf':s['asOf'],'researchAsOf':'2026-10-07'}
    j={'id':'unified-'+source,'businessId':'b1','dataNature':'demo','snapshotId':s['id'],'sessionId':'s','mode':mode,'purpose':'operating' if source=='generation' else 'analysis','question':question,'envelope':env,'budget':{'maxMarketSearches':0}}
    j.update(changes);return j

def execute(tmp_path,j,model):
    async def run():
        q=JobQueue(tmp_path/'jobs.sqlite');q.initialize();q.submit(j,source_hash(j))
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'checkpoints')) as saver:
            await run_once(q,'worker',saver,model_factory=lambda:model,poll_seconds=.005)
            observed=q.observe(j['id']);assert not await run_once(q,'worker',saver,model_factory=lambda:model)
        return observed,q
    return asyncio.run(run())

class QueryModel(MockModel):
    def __init__(self):self.calls=0;self.names=[]
    async def call(self,messages,tools=None):
        self.calls+=1;self.names.extend(t['function']['name'] for t in tools or [])
        message,_=await super().call(messages,tools)
        return message,{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100}

class CanonicalQueryModel:
    name='QUERY_TEST'
    def __init__(self):self.calls=0
    async def call(self,messages,tools=None):
        self.calls+=1;assert not tools
        from semantic_model_stub import semantic_response
        checked=semantic_response(messages)
        if checked:return checked,{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100}
        return {'role':'assistant','content':json.dumps(answer())},{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100}

@pytest.mark.parametrize('source',['snapshot','generation'])
def test_both_sources_use_shared_graph_selective_calls_and_saved_assessment(tmp_path,source):
    j=job(source);model=QueryModel() if source=='snapshot' else CanonicalQueryModel()
    observed,q=execute(tmp_path,j,model);assert observed['status']=='completed',observed
    r=observed['result'];a=r['businessAssessment'];scope=a['scope']
    assert scope['businessId']=='b1' and scope['inputId']==j['snapshotId'] and scope['researchAsOf']=='2026-10-07'
    assert scope['sourceKind']==source and scope['configurationVersion']
    assert a['taskType']=='QUERY' and a['optimality']=='unavailable'
    assert a['projections']['finding']==r['finding'] and a['projections']['specialists']==r['specialists']
    assert a['context']['completeReview'] is False
    assert list(r['specialists'])==['conversion']
    assert model.calls==2
    assert observed['observability']['limits']['maxTokens'] is None and observed['observability']['limits']['maxModelCalls'] is None
    assert observed['observability']['reportedTokens']==1100*model.calls
    assert any(t['phase']=='query_calculation' for t in r['toolReads'] if 'phase' in t)
    if source=='snapshot':assert not {'forecast','simulate_scenario','search_market'}&set(model.names)
    else:assert a['metrics']['paidOrders']['value']==20 and a['metrics']['contributionMarginCents']['value'] is None
    with q.db() as c:assert c.execute("SELECT COUNT(*) FROM model_calls WHERE state='completed'").fetchone()[0]==model.calls

def test_canonical_full_review_three_specialists_joint_and_shared_versions(tmp_path):
    j=job('generation',question='综合复核经营',mode='joint');model=CanonicalQueryModel()
    r,_=execute(tmp_path,j,model);assert r['status']=='completed',r
    a=r['result']['businessAssessment'];assert set(r['result']['operatingReviews'])=={'conversion','supply','market','joint'}
    assert model.calls==5 and a['context']['completeReview'] is True
    assert a['scope']['operatingVersion']=='operating-v1' and a['scope']['configurationVersion']=='p:config-one'
    assert {'metric','calculation','enterprise_rule','claim'}<={x['kind'] for x in a['context']['versions']}

@pytest.mark.parametrize('question,task,tokens,calls',[('库存多少','QUERY',12000,3),('查看在途','QUERY',12000,3),('解释贡献毛利口径','EXPLAIN',12000,3),('分析库存问题','DIAGNOSE',60000,8),('预测销量','FORECAST',60000,8),('如果到货延期，模拟方案','SIMULATE',120000,12),('比较调拨方案','SIMULATE',120000,12),('优先核查什么','DECIDE',60000,8),('综合复核经营','REVIEW',60000,8)])
def test_task_recognition_caps_and_manual_independence(question,task,tokens,calls):
    j=job(question=question,budget={'maxTokens':256000,'maxModelCalls':32})
    assert plan_task(j)['taskType']==task
    limits=task_limits(j,DEFAULT_LIMITS);assert limits['maxTokens'] is None and limits['maxModelCalls'] is None
    j['budget']={'maxTokens':9000,'maxModelCalls':1};assert task_limits(j,DEFAULT_LIMITS)['maxTokens'] is None

@pytest.mark.parametrize('source',['snapshot','generation'])
def test_scope_time_and_packed_context_are_enforced(source):
    j=job(source);assert frozen_scope(j)['researchAsOf']=='2026-10-07'
    bad=copy.deepcopy(j);bad['businessId']='other'
    with pytest.raises(ValueError):frozen_scope(bad)
    bad=copy.deepcopy(j);bad['envelope']['runtimeScope']['dataNature']='business'
    with pytest.raises(ValueError):frozen_scope(bad)
    bad=copy.deepcopy(j);bad['envelope']['runtimeScope']['researchAsOf']='2020-01-01'
    with pytest.raises(ValueError):frozen_scope(bad)
    if source=='generation':
        bad=copy.deepcopy(j);bad['envelope']['operatingBasis']['metrics']['paidOrders']['value']=None
        # Unknown remains unknown; code grounding prohibits numeric zero claims.
        from neo_agent.operating_reviews import grounded_review
        with pytest.raises(ValueError):grounded_review(answer(),bad['envelope']['operatingBasis'],[])
        bad=copy.deepcopy(j);bad['envelope']['operatingBasis']['period']['end']='2027-01-01'
        with pytest.raises(ValueError):Job.model_validate(bad)
    else:
        env=j['envelope'];raw=json.dumps({k:v for k,v in env.items() if k!='runtimeScope'}).encode()
        j['envelope']={'envelopePacked':{'codec':'gzip-base64','payload':base64.b64encode(gzip.compress(raw)).decode(),'rawBytes':len(raw)},'runtimeScope':env['runtimeScope']}
        assert frozen_scope(j)['researchAsOf']=='2026-10-07'

def test_disabled_required_role_and_exhaustion_keep_partial_not_complete(tmp_path):
    j=job('generation',question='综合复核经营',mode='joint')
    j['envelope']['operatingBasis']['configuration']['settings']={'agents':{'market':{'enabled':False}}}
    result,_=execute(tmp_path,j,CanonicalQueryModel());assert result['status']=='failed'
    assert result['observability']['errorCode']=='REQUIRED_ROLE_DISABLED'
    assert result['result']['partial'] and result['result']['unfinishedAreas'] and result['result']['verifiedMetrics']
    assert 'businessAssessment' not in result['result']
    j=job('generation',question='综合复核经营',mode='joint',budget={'maxModelCalls':2,'maxMarketSearches':0})
    result,_=execute(tmp_path/'limited',j,CanonicalQueryModel());assert result['status']=='completed'
    assert result['result']['businessAssessment']['context']['completeReview'] is True

def test_future_source_and_unsupported_optimal_claim_fail_validation(tmp_path):
    class Unsupported(CanonicalQueryModel):
        async def call(self,messages,tools=None):
            value=answer();value['nextAction']['reason']='此为最优方案'
            return {'role':'assistant','content':json.dumps(value)},{'total_tokens':20}
    result,_=execute(tmp_path,job('generation'),Unsupported());assert result['status']=='failed' and result['result']['partial']
    assert 'businessAssessment' not in result['result']

@pytest.mark.parametrize('source',['snapshot','generation'])
def test_small_legacy_budget_does_not_prevent_verified_assessment(tmp_path,source):
    model=QueryModel() if source=='snapshot' else CanonicalQueryModel()
    r,_=execute(tmp_path,job(source,budget={'maxTokens':100,'maxMarketSearches':0}),model)
    assert r['status']=='completed' and r['observability']['errorCode'] is None
    assert r['result']['businessAssessment'] and r['result']['finding'] and model.calls==2

def test_external_readability_is_not_applicability_and_future_citation_is_rejected():
    from neo_agent.runtime import assessment_document
    j=job('generation');source={'id':'source1','verificationStatus':'source_read','publishedAt':'2026-09-24','retrievedAt':'2026-10-07'}
    draft={'finding':{'conclusion':'待核对来源适用范围','evidenceIds':['source1'],'gaps':[],'alternatives':[],'candidates':[]},'marketEvidence':[source],'specialists':{}}
    state={'job':j,'scope':frozen_scope(j),'runtimePlan':plan_task(j)}
    a=assessment_document(state,draft);assert a['evidence'][0]['sourceReadable'] and not a['evidence'][0]['applicabilityVerified']
    draft['marketEvidence'][0]['retrievedAt']='2026-10-08'
    with pytest.raises(ValueError,match='截止'):assessment_document(state,draft)

def test_nested_home_numeric_prose_is_grounded_in_actual_calculation_values():
    from neo_agent.validation import validate_numeric_prose,numeric_values
    allowed=numeric_values({'netRevenueCents':75099420})
    validate_numeric_prose({'homeDecision':{'judgment':{'summary':'净成交750994.20元'}}},allowed,{})
    with pytest.raises(ValueError,match='数字'):
        validate_numeric_prose({'homeDecision':{'jointReview':{'nextAction':{'summary':'预计收益9999999元'}}}},allowed,{})

def test_saved_market_source_keeps_external_provenance_and_cutoff():
    from neo_agent.runtime import assessment_document
    j=job('generation');source={'id':'saved-source','verificationStatus':'source_read','publishedAt':'2026-09-24','retrievedAt':'2026-10-07','content':'已保存的原文'}
    j['envelope']['decisionContext']={'marketEvidence':[source]}
    draft={'finding':{'conclusion':'来源适用性仍待核对','evidenceIds':['saved-source'],'gaps':[],'alternatives':[],'candidates':[]},'marketEvidence':[],'specialists':{}}
    state={'job':j,'scope':frozen_scope(j),'runtimePlan':plan_task(j)}
    a=assessment_document(state,draft)
    assert a['evidence'][0]['kind']=='external' and not a['evidence'][0]['applicabilityVerified']
    assert a['projections']['marketEvidence']==[source]
    source['retrievedAt']='2026-10-08'
    with pytest.raises(ValueError,match='截止'):assessment_document(state,draft)

@pytest.mark.parametrize('source',['snapshot','generation'])
def test_packed_inputs_execute_the_same_selective_graph(tmp_path,source):
    j=job(source);env=j['envelope'];raw=json.dumps(env).encode()
    j['envelope']={'envelopePacked':{'codec':'gzip-base64','payload':base64.b64encode(gzip.compress(raw)).decode(),'rawBytes':len(raw)}}
    r,_=execute(tmp_path,j,QueryModel() if source=='snapshot' else CanonicalQueryModel())
    assert r['status']=='completed',r
    assert r['result']['businessAssessment']['taskType']=='QUERY'
    assert r['result']['businessAssessment']['scope']['researchAsOf']=='2026-10-07'
    assert set(r['result']['specialists'])=={'conversion'}

def test_home_synthesis_reads_saved_basis_from_packed_input():
    from neo_agent.runtime import NeoRuntime
    j=job(purpose='home');env=j['envelope']
    env['homeDecisionContext']={'forecast':{'id':'frozen-baseline'}}
    env['ontologyRef']={'id':'frozen-ontology'}
    raw=json.dumps(env).encode()
    j['envelope']={'envelopePacked':{'codec':'gzip-base64','payload':base64.b64encode(gzip.compress(raw)).decode(),'rawBytes':len(raw)},'ontologyRef':env['ontologyRef']}
    async def run():
        async with AsyncSqliteSaver.from_conn_string(':memory:') as saver:
            runtime=NeoRuntime(saver,QueryModel())
            async def specialist(*args,**kwargs):return {'conclusion':'已核对资料'},[],[],[]
            runtime.legacy.specialist=specialist
            out=await runtime.synthesize({'job':j,'scope':{'sourceKind':'snapshot'},'findings':{'conversion':{},'supply':{}},'calculationContext':{},'evidence':[],'usage':[],'toolReads':[]})
            assert out['draft']['homeDecisionBasis']==env['homeDecisionContext']
            assert out['draft']['ontologyRef']==env['ontologyRef']
            assert j['envelope'].keys()=={'envelopePacked','ontologyRef'}
    asyncio.run(run())

def test_numeric_error_gets_only_a_bounded_journaled_repair(tmp_path):
    class Repairable(QueryModel):
        bad=False
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return await super().call(messages,tools)
            if self.bad:
                assert '金额必须使用元原值，不写万/亿' in messages[-1]['content']
                self.calls+=1;return self.correct,{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100}
            msg,usage=await super().call(messages,tools)
            if not msg.get('tool_calls'):
                self.correct=copy.deepcopy(msg);self.bad=True;value=json.loads(msg['content']);value['conclusion']='净成交9999999元';msg={**msg,'content':json.dumps(value)}
            return msg,usage
    model=Repairable();r,_=execute(tmp_path,job(),model)
    assert r['status']=='completed',r
    assert r['result']['businessAssessment']['context']['semanticValidation']['status']=='verified'
    assert model.calls==3 and r['observability']['modelInvocations']==3 and r['observability']['reportedTokens']==3300
    assert r['result']['finding']

@pytest.mark.parametrize('source',['snapshot','generation'])
@pytest.mark.parametrize('question,task',[('支付订单多少','QUERY'),('解释支付订单口径','EXPLAIN')])
def test_orchestrator_small_requests_normalize_subject_roles_and_tools(tmp_path,source,question,task):
    model=QueryModel() if source=='snapshot' else CanonicalQueryModel()
    r,_=execute(tmp_path,job(source,question=question,mode='orchestrator'),model)
    assert r['status']=='completed',r
    plan=r['result']['runtimePlan']
    assert plan['taskType']==task and plan['selected']==plan['requiredRoles']==['conversion']
    assert not {'read_decisions','simulate_scenario','forecast','search_market'}&set(plan['tools'])
    assert model.calls==2
    assert r['observability']['limits']['maxTokens'] is None and r['observability']['limits']['maxModelCalls'] is None

def test_canonical_orchestration_normalizes_before_required_roles_and_disabled_gate(tmp_path):
    r,_=execute(tmp_path,job('generation',question='优先核查什么',mode='orchestrator'),CanonicalQueryModel())
    assert r['status']=='completed',r
    assert r['result']['runtimePlan']['selected']==r['result']['runtimePlan']['requiredRoles']==['joint']

def test_canonical_simulation_marks_uncomputed_required_step_partial_without_generic_model(tmp_path):
    model=CanonicalQueryModel();r,_=execute(tmp_path,job('generation',question='如果新到货，模拟这个方案',mode='orchestrator'),model)
    assert r['status']=='failed' and r['observability']['errorCode']=='SCENARIO_STEP_UNSUPPORTED'
    assert r['result']['partial'] and r['result']['verifiedMetrics'] and r['result']['finding'] is None
    assert '本次情景尚未完成' in r['result']['unfinishedAreas'][0] and 'typed' in r['error']
    assert 'businessAssessment' not in r['result'] and model.calls==0
    assert r['observability']['limits']['maxTokens'] is None and r['observability']['limits']['maxModelCalls'] is None

@pytest.mark.parametrize('source',['snapshot','generation'])
@pytest.mark.parametrize('question,task',[('列出已保存选择记录','QUERY'),('解释已保存方案记录','EXPLAIN')])
def test_saved_record_query_keeps_organization_reader_with_simple_cap(tmp_path,source,question,task):
    request=job(source,question=question,mode='orchestrator')
    records={'businessId':'b1','dataNature':'demo','generationId':'g','records':[{'id':'choice-a','status':'saved_decision','createdAt':'2026-10-07','reason':'先确认供给'}],'registryHash':'hash-a','truncated':False}
    if source=='generation':
        request['envelope']['operatingBasis']['savedRecords']=records
        class RecordModel(CanonicalQueryModel):
            async def call(self,messages,tools=None):
                if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return await super().call(messages,tools)
                payload=json.loads(messages[1]['content']);assert payload['basis']['savedRecords']==records
                assert '目录' in payload['recordReadNotice']
                response,usage=await super().call(messages,tools);value=json.loads(response['content']);value['evidenceIds']=['choice-a'];response['content']=json.dumps(value)
                return response,usage
        model=RecordModel()
    else:
        request['envelope']['decisionContext']={'decisions':records['records'],'scenarios':[]}
        class RecordModel(QueryModel):
            async def call(self,messages,tools=None):
                if messages[-1]['role']=='tool':
                    reads=[json.loads(m['content']) for m in messages if m['role']=='tool' and m.get('tool_call_id')=='decisions']
                    assert reads and 'saved_decision' in json.dumps(reads) and '先确认供给' in json.dumps(reads,ensure_ascii=False)
                return await super().call(messages,tools)
        model=RecordModel()
    r,_=execute(tmp_path,request,model);assert r['status']=='completed',r
    plan=r['result']['runtimePlan'];assert plan['taskType']==task and plan['requiresSavedRecords']
    assert plan['selected']==plan['requiredRoles']==(['joint'] if source=='generation' else ['orchestrator'])
    assert 'read_decisions' in plan['tools'] and not {'forecast','simulate_scenario','search_market'}&set(plan['tools'])
    assert any(t['tool']=='read_decisions' and t['status']=='completed' for t in r['result']['toolReads'])
    assert r['observability']['limits']['maxTokens'] is None and r['observability']['limits']['maxModelCalls'] is None
    assert model.calls==(2 if source=='generation' else 3)

def test_canonical_record_query_missing_registry_is_explicit_partial(tmp_path):
    model=CanonicalQueryModel();r,_=execute(tmp_path,job('generation',question='列出已保存选择记录',mode='orchestrator'),model)
    assert r['status']=='failed' and r['observability']['errorCode']=='SAVED_RECORD_CONTEXT_MISSING'
    assert r['result']['partial'] and r['result']['verifiedMetrics'] and model.calls==0

def test_canonical_record_query_rejects_foreign_registry(tmp_path):
    request=job('generation',question='列出已保存方案记录',mode='orchestrator')
    request['envelope']['operatingBasis']['savedRecords']={'businessId':'other','dataNature':'demo','generationId':'g'}
    model=CanonicalQueryModel();r,_=execute(tmp_path,request,model)
    assert r['status']=='failed' and '保存记录冻结范围不一致' in r['error'] and model.calls==0


def test_provider_json_object_marker_is_normalized_after_journalled_planned_reads(tmp_path):
    class ExtraField(QueryModel):
        async def call(self,messages,tools=None):
            response,usage=await super().call(messages,tools)
            if response.get('content') and not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                assert len([m for m in messages if m['role']=='tool'])==2
                value=json.loads(response['content']);value['type']='json_object';response['content']=json.dumps(value)
            return response,usage
    model=ExtraField();r,q=execute(tmp_path,job(),model)
    assert r['status']=='completed',r
    assert model.calls==2 and r['observability']['limits']['maxModelCalls'] is None
    assert r['result']['businessAssessment']['context']['semanticValidation']['status']=='verified'
    assert {x['tool'] for x in r['result']['toolReads']} >= {'describe_business','read_business'}
    with q.db() as c:
        assert c.execute("SELECT count(*) FROM tool_operations WHERE state='completed'").fetchone()[0]>=2


def test_simple_query_can_finish_generation_and_semantic_check_without_call_budget(tmp_path):
    from neo_agent.execution import JournaledModel,ExecutionError
    async def run():
        q=JobQueue(tmp_path/'slots.sqlite');q.initialize();j=job();q.submit(j,source_hash(j));q.claim('worker')
        delegate=QueryModel();model=JournaledModel(q,j['id'],delegate,'worker');model.reserve_semantic_slot=True
        for i in range(2):await model.call([{'role':'system','content':'generation'+str(i)}])
        await model.call([{'role':'system','content':'extra generation'}])
        assert delegate.calls==3
        await model.call([{'role':'system','content':'NEO_SEMANTIC_SUPPORT_CHECK'},{'role':'user','content':json.dumps({'evidence':[],'statements':[]})}])
        assert delegate.calls==4
    asyncio.run(run())


def test_negative_review_instruction_keeps_count_query_small():
    from neo_agent.task_plan import recognize_task
    from neo_agent.agent import order_query_metrics,query_metric_projection
    question='当前统计期间支付订单和退款各有多少笔？只回答已录入数字、统计期间和数据完整性，不要进行完整研判。'
    assert recognize_task({'question':question})=='QUERY'
    assert recognize_task({'question':'不要分析原因，只查询退款笔数'})=='QUERY'
    assert recognize_task({'question':'不要预测销量，综合审查目前经营问题'})=='REVIEW'
    assert order_query_metrics('当前统计期间支付订单和退款各有多少笔？')=={'paidOrders','paidUnits','refundOrders','refundUnits'}
    projected=query_metric_projection('read_business',{'totals':{'paidOrders':69,'paidUnits':75,'refundOrders':13,'refundUnits':15,'netRevenueCents':123,'metricStatus':{'paidOrders':{'status':'partial','knownValue':69},'paidUnits':{'status':'partial','knownValue':75}}}},'当前统计期间支付订单和退款各有多少笔？')
    assert projected['totals']['metricStatus']['paidOrders']['status']=='partial'
    assert 'netRevenueCents' not in projected['totals']


def test_count_prompt_retains_incomplete_order_period_without_unrelated_finance():
    from neo_agent.agent import query_metric_projection
    out={'totals':{'paidOrders':69},'coverage':{'orders':'partial','expenses':'partial'},'limitations':['orders 未完整覆盖统计期；缺失日期不能当成零。','成本或费用/订单期间覆盖不足，贡献毛利待补数据。']}
    projected=query_metric_projection('read_business',out,'当前统计期间支付订单和退款各有多少笔？')
    assert projected['coverage']=={'orders':'partial'}
    assert projected['limitations']==[out['limitations'][0]]
    assert len(out['limitations'])==2

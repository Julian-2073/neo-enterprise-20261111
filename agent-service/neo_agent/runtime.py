from .current_knowledge import read_knowledge,knowledge_versions,knowledge_catalog
"""One checkpointed execution flow; domain-specific readers remain adapters.

New snapshot and canonical generation jobs both execute this graph. All numeric
results still originate in the existing Python/TS calculation services.
"""
import copy
import json
import re
from datetime import date,timedelta
from typing import TypedDict
from langgraph.graph import StateGraph,START,END
from .agent import AgentRuntime,deterministic_fact_answer,model_business_data,model_tool_data,model_table_data,model_reference_data
from .operating_reviews import OperatingAgentRuntime,OPERATING_REVIEW_VERSION
from .contracts import Job
from .models import BusinessAssessment,AssessmentScope
from .claim_support import check_claim_support,deterministic_claim_support,completed_market_sources,single_layer_denial,supports_prose_repair
from .assessment_conversion import priority_action,hypothesis_records
from .task_plan import plan_task
from .engine import source_hash
from .ontology import expand_ontology
from .platform_settings import enabled_roles
from .business_queries import query_facts
from .business_tools import read_fact_view
from .execution import ExecutionError
from .validation import numeric_values,validate_numeric_prose
from decimal import Decimal

class RuntimeState(TypedDict,total=False):
    job:dict
    runtimePlan:dict
    scope:dict
    claims:list
    claimVerificationCache:dict
    selected:list
    findings:dict
    reviews:dict
    evidence:list
    usage:list
    toolReads:list
    marketGaps:list
    calculationContext:dict
    diagnostics:dict
    draft:dict
    assessment:dict
    result:dict
    deterministicAnswer:bool

def frozen_scope(job):
    # Revalidate when executing: callers can submit jobs without FastAPI.
    Job.model_validate(job)
    env=expand_ontology(job['envelope']);snapshot=env['snapshot'];basis=env.get('operatingBasis')
    frozen=env.get('runtimeScope',{})
    configuration=(basis or {}).get('configuration') or env.get('platformConfiguration') or {}
    scope=AssessmentScope(businessId=job['businessId'],dataNature=job['dataNature'],inputId=job['snapshotId'],
        sourceKind='generation' if basis else 'snapshot',metricScope=(basis or {}).get('metricScope') or {k:v for k,v in env.get('conversation',{}).get('active',{}).items() if k in ('entityId','skuId','channelId','period','scenarioIds','topic')} or None,
        operatingVersion=str((basis or {}).get('operatingVersion') or snapshot.get('calculationVersion') or 'legacy-unversioned'),
        asOf=snapshot['asOf'],researchAsOf=frozen.get('researchAsOf') or snapshot.get('researchAsOf') or snapshot['asOf'],
        configurationVersion=str((basis or {}).get('profileVersion','legacy') )+':'+str(configuration.get('id') or configuration.get('version') or 'legacy-unversioned'))
    for key in ('businessId','dataNature','inputId','asOf'):
        if frozen.get(key) is not None and frozen[key]!=getattr(scope,key):raise ValueError('运行冻结范围不一致：'+key)
    date.fromisoformat(scope.asOf[:10]);date.fromisoformat(scope.researchAsOf[:10])
    if scope.researchAsOf[:10]<scope.asOf[:10]:raise ValueError('市场观察截止早于经营截至日')
    return scope.model_dump()

def canonical_result(state,model):
    reviews=state.get('reviews',{});chosen=reviews.get('joint') or next((v for v in reviews.values() if v.get('status')!='disabled'),None)
    if not chosen:raise ValueError('本次请求的专业已停用，没有可保存判断')
    intent=state.get('runtimePlan',{}).get('answerContract',{}).get('intent')
    def finding(review):
        return {'answerIntent':intent,'conclusion':review['explanation'],'basis':[review['headline']],'nextStep':review['nextAction']['title'],'evidenceIds':review['evidenceIds'],'alternatives':[h['statement'] for h in review.get('hypotheses',[])],
            'gaps':[q['question'] for q in review.get('confirmations',[])]+review.get('limitations',[]),
            'candidates':[review['nextAction']['title']],'followups':[]}
    job=state['job'];basis=expand_ontology(job['envelope'])['operatingBasis']
    return {'finding':finding(chosen),'specialists':{k:finding(v) for k,v in reviews.items() if k!='joint' and v.get('status')!='disabled'},
        'operatingReviews':reviews,'marketEvidence':state.get('evidence',[]),'usage':state.get('usage',[]),'toolReads':state.get('toolReads',[]),
        'model':getattr(model,'name','test-adapter'),'snapshotId':job['snapshotId'],'businessId':job['businessId'],
        'dataNature':job['dataNature'],'generationId':basis['generationId'],'reviewVersion':OPERATING_REVIEW_VERSION}

def asserted_optimality(value):
    """Inspect prose leaves separately; a warning is not an optimality claim."""
    if isinstance(value,dict):return any(asserted_optimality(v) for v in value.values())
    if isinstance(value,list):return any(asserted_optimality(v) for v in value)
    if not isinstance(value,str):return False
    target=r'(?:全局最优|方案最优|最优(?:方案)?|最佳方案|收益最大)'
    denial=re.compile(r'(?:尚不能|不能|无法|不得|不应|尚不足以|不足以)(?:据此)?(?:声称|认定|证明|保证|确认|判定|判断)'+target+r'(?:或'+target+r')*')
    prose=denial.sub(lambda m:single_layer_denial(m,value),value)
    return bool(re.search(r'全局最优|最优方案|最佳方案|收益最大',prose))


def assessment_document(state,draft):
    job=state['job'];env=expand_ontology(job['envelope']);basis=env.get('operatingBasis');final=draft['finding'];reviews=draft.get('operatingReviews',{})
    scope=state['scope'];sources=draft.get('marketEvidence',[]);simple=state['runtimePlan']['taskType'] in ('QUERY','EXPLAIN')
    if not basis:
        allowed=numeric_values(state.get('calculationContext',{}));allowed.update(numeric_values(state.get('diagnostics',{})))
        for read in draft.get('toolReads',[]):
            allowed.update(Decimal(v) for v in read.get('numericGrounding',[]))
            allowed.percentage_basis.update(Decimal(v) for v in read.get('percentageGrounding',[]))
        for finding in [final,*draft.get('specialists',{}).values()]:validate_numeric_prose(finding,allowed,env.get('domain',{}))
    cited=set()
    def collect_ids(v):
        if isinstance(v,dict):
            for k,x in v.items():
                if k in ('evidenceIds','selectedSourceIds') and isinstance(x,list):cited.update(x)
                else:collect_ids(x)
        elif isinstance(v,list):
            for x in v:collect_ids(x)
    collect_ids([final,draft.get('specialists',{}),reviews])
    sources=list({s['id']:s for s in [*sources,*[s for s in env.get('decisionContext',{}).get('marketEvidence',[]) if s['id'] in cited]]}.values())
    for source in sources:
        if source['id'] in cited and any(str(source.get(key) or '')[:10]>scope['researchAsOf'][:10] for key in ('publishedAt','retrievedAt')):
            raise ValueError('引用原文超出冻结市场观察截止')
    metrics=copy.deepcopy(basis['metrics'] if basis else state.get('calculationContext',{}))
    current=reviews.get('joint') or next((v for v in reviews.values() if v.get('nextAction')),None)
    confirmations=copy.deepcopy(current.get('confirmations',[]) if current else [] if simple else [{'question':g,'impact':'可能改变经营判断','method':'核对相关来源与业务口径'} for g in final.get('gaps',[])])
    conditions=list(dict.fromkeys(final.get('gaps',[])+(current.get('limitations',[]) if current else [])))
    objective=(basis or {}).get('profile',{}).get('objective') or env.get('objective')
    constraints=(basis or {}).get('constraints') or env.get('confirmedConstraints')
    scenario=(basis or {}).get('scenarioContext',{})
    constrained=bool(objective and ((basis or {}).get('baseline',{}).get('feasibility',{}).get('status')=='feasible' or scenario.get('recommendation',{}).get('scenarioId'))) if basis else bool(objective and constraints)
    if not simple and not objective:conditions.append('本轮未提供经营目标，不能声称最优方案')
    if not simple and not constraints:conditions.append('本轮未提供已确认的完整经营约束，建议须逐项核实可执行条件')
    if not constrained and asserted_optimality([final,reviews]):raise ValueError('缺少目标或约束，不能声称最优方案')
    problems=[] if simple else [{'role':role,'statement':f['conclusion'],'evidenceIds':f.get('evidenceIds',[])} for role,f in draft.get('specialists',{}).items()]
    candidates=[{'action':a,'status':'proposed','conditions':conditions} for a in final.get('candidates',[])]
    hypotheses=hypothesis_records(final,state.get('claims',[]))
    for review in reviews.values():
        for h in review.get('hypotheses',[]):
            hypotheses.append({**copy.deepcopy(h),'status':'unconfirmed','supportStatus':next((c['status'] for c in state.get('claims',[]) if c['statement']==h['statement']),'insufficient'),'confirmationRequired':True})
    priority=copy.deepcopy(current.get('nextAction') if current else candidates[0] if candidates else None)
    priority=None if simple else priority_action(priority,final,scope,env,conditions,state.get('claims',[]))
    if priority and current:
        priority['candidates']+=copy.deepcopy(current.get('alternatives',[]))
        priority['rejectionReasons'] += [{'action':a['action'],'reason':a['whyNotFirst'],'status':'proposed_reason'} for a in current.get('alternatives',[])]
    projections={k:copy.deepcopy(draft[k]) for k in ('finding','specialists','operatingReviews','marketEvidence') if k in draft}
    valid_reviews={k for k,v in reviews.items() if v.get('status')!='disabled' and v.get('nextAction')}
    full=set(('conversion','supply','market')).issubset(draft.get('specialists',{})) or set(('conversion','supply','market','joint')).issubset(valid_reviews)
    professional={} if simple else {role:copy.deepcopy(f.get('businessReview') or {'title':{'conversion':'客户转化判断','supply':'供给判断','market':'市场判断'}[role],'summary':f['conclusion'],'evidenceIds':f['evidenceIds']}) for role,f in draft.get('specialists',{}).items() if role in ('conversion','supply','market')}
    projections['marketEvidence']=copy.deepcopy(sources)
    projections['professional']=professional
    if full and not basis and not projections['finding'].get('homeDecision'):
        forecast=env.get('homeDecisionContext',{}).get('forecast')
        judgment={'title':'当前经营判断','summary':final['conclusion'][:160],'evidenceIds':final['evidenceIds']}
        action=final.get('candidates',['核对待确认条件'])[0] if final.get('candidates') else '核对待确认条件'
        projections['finding']['homeDecision']={'judgment':judgment,'outlook':{'forecastId':forecast.get('id') if forecast else None,'title':'维持现状的预测依据' if forecast else '预测资料尚未保存','summary':'使用已保存的计算结果，条件与缺口须核对。' if forecast else '尚无已保存预测，暂不能给出数值结论。','evidenceIds':forecast.get('evidenceIds',[]) if forecast else []},'action':{'title':action[:36],'summary':final['conclusion'][:160],'evidenceIds':final['evidenceIds'],'steps':final.get('candidates',[])[:3] or ['核对已列出的确认条件']},'sections':professional,'knowledgeVersion':'冻结经营依据','knowledgeRuleIds':[]}
    brief=copy.deepcopy(final.get('organization'))
    if full and not brief:
        # A compatible brief is a projection of this validated judgment. It
        # neither reruns a model nor invents scenario comparisons or outcomes.
        brief={'headline':(final.get('homeDecision') or {}).get('judgment',{}).get('title','当前经营判断'),'summary':final['conclusion'][:180],
            'priorities':[{'title':str(priority.get('title') or priority.get('action') or '核对经营条件')[:60],'reason':str(priority.get('reason') or priority.get('whyFirst') or final['conclusion'])[:180],'evidenceIds':final['evidenceIds'],'urgency':'先核查'}] if priority else [],
            'comparisons':[],'savedChoices':[],'nextChecks':conditions[:5]}
        projections['finding']['organization']=brief
    projections['joint']=copy.deepcopy(projections['finding'])
    projections['brief']=brief
    projections['market']=copy.deepcopy(draft.get('specialists',{}).get('market',{}).get('marketWorkbench'))
    return BusinessAssessment(scope=scope,taskType=state['runtimePlan']['taskType'],inputHash=source_hash(job),metrics=metrics,
        problems=problems,hypotheses=hypotheses,claims=state.get('claims',[]),evidence=[{'id':e,'kind':'business'} for e in final.get('evidenceIds',[]) if e not in {s['id'] for s in sources}]+[
            {'id':s['id'],'kind':'external','sourceReadable':s.get('verificationStatus')=='source_read','applicabilityVerified':False,'publishedAt':s.get('publishedAt'),'retrievedAt':s.get('retrievedAt'),'historicalEligible':s.get('historicalEligible',False)} for s in sources],
        confirmations=confirmations,candidates=candidates,priorityAction=priority,reviewConditions=conditions,
        optimality='conditional' if constrained else 'unavailable',projections=projections,
        context={'semanticValidation':{'version':'semantic-support-v1','status':'verified','claimCount':len(state.get('claims',[]))},'conversation':env.get('conversation'),'diagnostics':state.get('diagnostics'),'citationVersion':'citation-context-v1','taskBudgetClass':state['runtimePlan']['budgetClass'],'completedRoles':list(reviews or draft.get('specialists',{})),
            'completeReview':full,'versions':[{'kind':'calculation','version':scope['operatingVersion'],'location':'server/business-review-basis.ts' if basis else 'agent-service/neo_agent/engine.py'},
                {'kind':'enterprise_rule','version':scope['configurationVersion'],'location':'envelope.operatingBasis.configuration' if basis else 'envelope.platformConfiguration'},
                {'kind':'configuration','id':'configuration:'+scope['configurationVersion'].rsplit(':',1)[-1],'version':scope['configurationVersion'].rsplit(':',1)[-1],'location':'envelope.operatingBasis.configuration' if basis else 'envelope.platformConfiguration'},
                {'kind':'metric','version':scope['operatingVersion'],'location':'businessAssessment.metrics'},
                *[{'kind':'query_calculation','version':r['queryEvidence']['method'],'location':'agent-service/neo_agent/business_queries.py'} for r in draft.get('toolReads',[]) if r.get('queryEvidence',{}).get('method')],
                *[{'kind':'saved_record_registry','version':r['registryHash'],'location':'envelope.operatingBasis.savedRecords','recordIds':r['recordIds'],'truncated':r['truncated']} for r in draft.get('toolReads',[]) if r.get('registryHash')],
                {'kind':'claim','version':source_hash({'scope':scope,'finding':final,'specialists':draft.get('specialists',{}),'reviews':reviews}),'schemaVersion':'business-assessment-v1','location':'businessAssessment.problems'},
                *[{'kind':'knowledge','version':r['knowledgeRef']['version'],'digest':r['knowledgeRef']['digest'],'ruleIds':r['knowledgeRef']['ruleIds'],'location':'agent-service/neo_agent/business-knowledge.json'} for r in draft.get('toolReads',[]) if r.get('knowledgeRef')],
                *knowledge_versions(state.get('claims',[])),
                *[{'kind':'document','version':s.get('contentHash') or source_hash({k:s.get(k) for k in ('content','excerpt','publishedAt','retrievedAt')}),'location':s.get('url'),'readability':s.get('verificationStatus'),'applicabilityVerified':False} for s in sources]],
            'industryPack':{'status':'used' if any(r['kind']=='industry_pack' for r in knowledge_versions(state.get('claims',[]))) else 'not_used','location':'server/knowledge-packs.ts' if any(r['kind']=='industry_pack' for r in knowledge_versions(state.get('claims',[]))) else None}}).model_dump(mode='json')

class NeoRuntime:
    def __init__(self,checkpointer,model,market=None,progress=None,observer=None):
        self.model=model;self.progress=progress;self.observer=observer
        self.legacy=AgentRuntime(checkpointer,model,market,progress,observer,build_graph=False)
        self.canonical=OperatingAgentRuntime(checkpointer,model,market,progress,observer,build_graph=False)
        graph=StateGraph(RuntimeState)
        for name,method in [('context_plan',self.context_plan),('query_calculation',self.query_calculation),('hypothesis_investigation',self.investigate),('synthesis',self.synthesize),('validation',self.validate),('save',self.save)]:graph.add_node(name,method)
        graph.add_edge(START,'context_plan');graph.add_edge('context_plan','query_calculation');graph.add_edge('query_calculation','hypothesis_investigation')
        graph.add_conditional_edges('hypothesis_investigation',lambda s:'synthesis' if all(r in (s.get('reviews',{}) if s['scope']['sourceKind']=='generation' else s.get('findings',{})) for r in s['selected']) else 'hypothesis_investigation')
        graph.add_edge('synthesis','validation');graph.add_edge('validation','save');graph.add_edge('save',END)
        self.graph=graph.compile(checkpointer=checkpointer)

    async def context_plan(self,state):
        job=state['job'];plan=plan_task(job);scope=frozen_scope(job)
        if scope['sourceKind']=='generation':
            plan['selected']=['joint' if r=='orchestrator' else r for r in plan['selected']]
        plan['requiredRoles']=list(plan['selected'])
        if scope['sourceKind']=='generation' and plan['taskType']=='SIMULATE':
            context=expand_ontology(job['envelope'])['operatingBasis'].get('scenarioContext',{})
            results=context.get('results',[])
            if not results or context.get('generationId')!=job['snapshotId'] or any(r.get('inputGeneration')!=job['snapshotId'] or r.get('status')!='calculated' or r.get('feasibility',{}).get('status')!='feasible' for r in results):
                plan['unsupportedSteps']=['本次情景尚未完成：需同代次typed参数、计算结果与已确认约束；保留已算指标，不能冒充推演完成。']
        if scope['sourceKind']=='snapshot':plan['selected']=enabled_roles(job['envelope'],plan['selected'])
        else:
            agents=expand_ontology(job['envelope'])['operatingBasis'].get('configuration',{}).get('settings',{}).get('agents',{})
            plan['selected']=[r for r in plan['selected'] if agents.get(r,{}).get('enabled') is not False]
        if not plan['selected']:raise ValueError('本次请求的专业已停用，没有可执行专业')
        if self.progress:await self.progress(job['id'],'理解问题意图，界定对象、时间和回答范围')
        knowledge=read_knowledge(expand_ontology(job['envelope']),job.get('question',''))
        read={'tool':'read_knowledge','status':'completed','operationKey':source_hash(['knowledge',job['id'],knowledge]),'result':knowledge}
        if self.observer and knowledge_catalog(knowledge):
            await self.observer('tool_started',read);await self.observer('tool_completed',read)
        return {'runtimePlan':plan,'scope':scope,'selected':plan['selected'],'findings':{},'reviews':{},'evidence':[],'usage':[],'toolReads':[read] if knowledge_catalog(knowledge) else [],'marketGaps':[]}

    async def query_calculation(self,state):
        # Canonical metrics/baseline have been computed before queue submission;
        # legacy adapter exposes bounded queries and existing calc services.
        if self.progress:await self.progress(state['job']['id'],'只读取回答所需的固定版本经营数据')
        job=state['job'];env=expand_ontology(job['envelope'])
        trace={'operationKey':source_hash(['runtime-input',job['snapshotId'],state['runtimePlan']]),'tool':'read_business','sourceKind':state['scope']['sourceKind']}
        if self.observer:await self.observer('tool_started',trace)
        if state['scope']['sourceKind']=='generation':
            records=env['operatingBasis'].get('savedRecords')
            if state['runtimePlan'].get('requiresSavedRecords') and records:
                if any(records.get(k)!=job[v] for k,v in [('businessId','businessId'),('dataNature','dataNature'),('generationId','snapshotId')]):raise ValueError('保存记录冻结范围不一致')
            diagnostics=env['operatingBasis'].get('diagnostics',{})
            metrics=env['operatingBasis']['metrics'];reads=[{'tool':'read_business','status':'completed','phase':'query_calculation','sourceKind':'generation','metricKeys':list(metrics),'inputRef':job['snapshotId']}]
            if state['runtimePlan'].get('requiresSavedRecords') and records:reads.append({'tool':'read_decisions','status':'completed','phase':'query_calculation','sourceKind':'generation','inputRef':job['snapshotId'],'recordIds':[r['id'] for r in records['records']],'registryHash':records['registryHash'],'truncated':records['truncated']})
        else:
            sections=state['runtimePlan'].get('computationSections') or [r for r in state['selected'] if r in ('conversion','supply','market')] or ['conversion']
            active=env.get('conversation',{}).get('active',{});args={k:v for k,v in {'productId':active.get('entityId'),'skuId':active.get('skuId'),'channel':active.get('channelId'),'periodStart':active.get('period',{}).get('start'),'periodEnd':active.get('period',{}).get('end')}.items() if v is not None}
            queried={role:query_facts(env,role,args) for role in sections};metrics={role:value['totals'] for role,value in queried.items()}
            diagnostics={'customerJourney':env.get('customerJourney'),'sections':{}}
            for role,value in queried.items():
                scope=value['scope'];days=(date.fromisoformat(scope['periodEnd'])-date.fromisoformat(scope['periodStart'])).days+1;half=days//2
                comparison=query_facts(env,role,{**args,'periodStart':(date.fromisoformat(scope['periodEnd'])-timedelta(days=max(half,1)-1)).isoformat(),'comparePrevious':True})
                diagnostics['sections'][role]={k:v for k,v in comparison.items() if k in ('scope','totals','previousPeriod','inventoryPosition','queryEvidence','coverage','aggregateCount')}

            reads=[{'tool':'read_business','status':'completed','phase':'query_calculation','sourceKind':'snapshot','arguments':{'section':role},'queryEvidence':value['queryEvidence'],'inputRef':job['snapshotId']} for role,value in queried.items()]
        if self.observer:await self.observer('tool_completed',{**trace,'metricKeys':list(metrics)})
        return {'calculationContext':metrics,'diagnostics':diagnostics,'toolReads':state['toolReads']+reads}

    async def investigate(self,state):
        if state['runtimePlan'].get('unsupportedSteps'):
            raise ExecutionError(state['runtimePlan']['unsupportedSteps'][0],'SCENARIO_STEP_UNSUPPORTED')
        if state['scope']['sourceKind']=='generation' and state['runtimePlan'].get('requiresSavedRecords') and not expand_ontology(state['job']['envelope'])['operatingBasis'].get('savedRecords'):
            raise ExecutionError('冻结依据未读取保存选择/方案记录；不能把缺少上下文解释成没有记录','SAVED_RECORD_CONTEXT_MISSING')
        operating=state['scope']['sourceKind']=='generation';done=state.get('reviews',{}) if operating else state.get('findings',{})
        role=next(r for r in state['selected'] if r not in done)
        if operating:return await self.canonical.review(state,'joint' if role=='orchestrator' else role)
        adapted=state
        if state['runtimePlan']['taskType']=='REVIEW' and len(state['selected'])>1 and state['job'].get('purpose') in ('home','briefing','weekly'):
            adapted={**state,'job':{**state['job'],'purpose':'review','mode':role}}
        direct=deterministic_fact_answer(expand_ontology(state['job']['envelope']),role,state['job']['question'],state['runtimePlan']['taskType'])
        if direct:
            env=expand_ontology(state['job']['envelope']);active=env.get('conversation',{}).get('active',{})
            args={k:v for k,v in {'productId':active.get('entityId'),'skuId':active.get('skuId'),'channel':active.get('channelId'),'periodStart':active.get('period',{}).get('start'),'periodEnd':active.get('period',{}).get('end')}.items() if v is not None}
            computed=read_fact_view(env,role,{**args,'grain':'period'})
            read={'tool':'read_business','status':'completed','phase':'deterministic_answer','sourceKind':'snapshot','arguments':{'section':role,**args,'grain':'period'},'queryEvidence':computed['queryEvidence'],'inputRef':state['job']['snapshotId']}
            selected_sources=[]
            if role=='market' and direct.get('evidenceIds'):
                selected=set(direct['evidenceIds'])
                selected_sources=[row for row in env.get('decisionContext',{}).get('marketEvidence',[]) if row.get('id') in selected and row.get('verificationStatus')=='source_read']
            return {'findings':{**done,role:direct},'evidence':state.get('evidence',[])+selected_sources,
                    'toolReads':state['toolReads']+[read],'deterministicAnswer':True}
        extra='\n本轮已实际计算的相关专业指标：'+json.dumps(state.get('calculationContext',{}),ensure_ascii=False) if len(state['runtimePlan'].get('computationSections',[]))>1 and role=='joint' else ''
        if role=='orchestrator':extra+='\n本轮已完成的固定范围计算（某个供给视图缺少财务字段，不表示财务汇总也缺失）：'+json.dumps(model_table_data(model_tool_data(model_business_data(state.get('calculationContext',{})))),ensure_ascii=False,separators=(',',':'))
        if state['runtimePlan']['taskType'] not in ('QUERY','EXPLAIN'):
            diagnostic=state.get('diagnostics',{})
            d=diagnostic.get('sections',{}).get(role) or {};prior=d.get('previousPeriod') or {}
            selected={'comparison':{k:d[k] for k in ('scope','totals','inventoryPosition') if k in d},'previousPeriod':{k:prior[k] for k in ('scope','totals','comparison','status') if k in prior},'customerJourney':diagnostic.get('customerJourney') if role=='conversion' else None}
            extra+='\n后台诊断与身份旅程（缺失不可当零，变化不能直接归因；sameAsContextRef复用此段contextRefs完整原值）：'+json.dumps(model_reference_data(model_table_data(model_tool_data(model_business_data(selected)))),ensure_ascii=False,separators=(',',':'))
        finding,evidence,usage,reads=await self.legacy.specialist(adapted,role,extra)
        return {'findings':{**done,role:finding},'evidence':state['evidence']+evidence,'usage':state['usage']+usage,'toolReads':state['toolReads']+reads}

    async def synthesize(self,state):
        operating=state['scope']['sourceKind']=='generation'
        if operating:
            updates={}
            if len(state['reviews'])>1 and 'joint' not in state['reviews']:updates=await self.canonical.review(state,'joint')
            merged={**state,**updates};return {**{k:v for k,v in updates.items() if k!='result'},'draft':canonical_result(merged,self.model)}
        if len(state['findings'])==1:final=next(iter(state['findings'].values()));updates={}
        else:
            role='orchestrator' if state['job'].get('purpose') in ('patrol','home','briefing','weekly') else 'joint'
            adapted={**state,'job':{**state['job'],'purpose':'analysis'}} if state['job'].get('purpose')=='review' else state
            if state['job'].get('purpose') in ('home','briefing','weekly'):adapted={**adapted,'runtimePrepared':True}
            context=state.get('calculationContext',{})
            # Finance totals share one query scope across roles. Supply's stock
            # positions and status remain a separate complete computed block.
            summary={'finance':context.get('conversion',next(iter(context.values()),{})),'supply':{k:v for k,v in context.get('supply',{}).items() if k in ('inventoryPosition','metricStatus')}}
            final,ev,u,reads=await self.legacy.specialist(adapted,role,'\n专业分析（保留反证和分歧）：'+json.dumps(state['findings'],ensure_ascii=False)+'\n服务已计算的完整期间汇总（金额Yuan为元）：'+json.dumps(model_table_data(model_tool_data(model_business_data(summary))),ensure_ascii=False,separators=(',',':')))
            updates={'evidence':state['evidence']+ev,'usage':state['usage']+u,'toolReads':state['toolReads']+reads}
        env=expand_ontology(state['job']['envelope'])
        return {**updates,'draft':{'finding':final,'specialists':state['findings'],'marketEvidence':updates.get('evidence',state['evidence']),
            'usage':updates.get('usage',state['usage']),'toolReads':updates.get('toolReads',state['toolReads']),'model':getattr(self.model,'name','test-adapter'),
            'snapshotId':state['job']['snapshotId'],'businessId':state['job']['businessId'],'dataNature':state['job']['dataNature'],
            'ontologyRef':env.get('ontologyRef'),**({'homeDecisionBasis':env['homeDecisionContext']} if state['job'].get('purpose')=='home' else {})}}

    async def validate(self,state):
        if set(state['runtimePlan']['requiredRoles'])-set(state['selected']):raise ExecutionError('完整研判所需专业已停用，已保存可用专业检查点；尚未完成完整研判','REQUIRED_ROLE_DISABLED')
        # Semantic gate executes before assessment construction or saved projections.
        draft={**state['draft'],'marketEvidence':completed_market_sources(expand_ontology(state['job']['envelope']),state['draft'])}
        verification_state=dict(state)
        async def verify(candidate):
            prepared=assessment_document({**state,'claims':[]},candidate)
            public={**candidate,**{k:prepared[k] for k in ('problems','hypotheses','candidates','priorityAction','reviewConditions','confirmations','projections')}}
            if state.get('deterministicAnswer'):
                return deterministic_claim_support(verification_state,public),[]
            return await check_claim_support(verification_state,public,self.model)
        from .home_semantic_repair import repair_home_prose
        for repair_count in range(3):
            try:
                claims,usage=await verify(draft)
                break
            except ExecutionError as error:
                error.recovery_draft=draft
                if getattr(error,'claim_cache',None):verification_state['claimVerificationCache']=error.claim_cache
                error.claim_cache=verification_state.get('claimVerificationCache',{})
                if error.code!='CLAIM_NOT_SUPPORTED' or state['scope']['sourceKind']!='snapshot' or not supports_prose_repair(state,draft):raise
                if repair_count==2:
                    # Preserve the schema-validated corrections as an internal
                    # synthesis checkpoint. They remain unpublished until the
                    # entire semantic gate passes on a later explicit resume.
                    error.recovery_draft=draft
                    raise
                await self.legacy.emit(state,'根据完整核对意见只修正未通过陈述，再核验全部结果')
                issues=getattr(error,'claim_issues',[])
                draft={**draft,'usage':draft.get('usage',[])+getattr(error,'usage',[])}
                draft,model_usage=await repair_home_prose(state,draft,issues,self.model)
                draft={**draft,'usage':draft.get('usage',[])+model_usage}
        draft={**draft,'usage':draft.get('usage',[])+usage}
        return {'claims':claims,'draft':draft,'assessment':assessment_document({**state,'claims':claims},draft),'findings':draft.get('specialists',{})}
    async def save(self,state):return {'result':{**state['draft'],'marketEvidence':state['assessment']['projections']['marketEvidence'],'businessAssessment':state['assessment'],'runtimePlan':state['runtimePlan']}}

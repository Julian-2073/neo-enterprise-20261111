"""Pure conversion contracts; one validated assessment owns all projections."""
import copy
from .engine import source_hash

def priority_action(action,final,scope,env,conditions,claims):
    """A proposed choice with traceable conditions, never an execution command."""
    if not action:return None
    basis=env.get('operatingBasis',{});scenario=basis.get('scenarioContext') or env.get('scenarioContext') or {}
    candidates=[{'action':a,'reason':'候选建议，须核对条件'} for a in final.get('candidates',[])]
    for spec in scenario.get('scenarios',[]):candidates.append({'scenarioId':spec['id'],'action':spec['name']})
    recommendation=scenario.get('recommendation') or {};selected=recommendation.get('scenarioId')
    compared=bool(selected and any(r['id']==selected and r.get('status')=='calculated' and r.get('feasibility',{}).get('status')=='feasible' for r in scenario.get('results',[])))
    rejected=[]
    for r in scenario.get('results',[]):
        if r['id']==selected:continue
        reasons=r.get('feasibility',{}).get('reasons') or []
        comparable=compared and r.get('status')=='calculated' and r.get('feasibility',{}).get('status')=='feasible'
        rejected.append({'scenarioId':r['id'],'status':'compared' if comparable else 'not_comparable','reason':reasons or (recommendation.get('reason') if comparable else recommendation.get('reason') or '未完成可比计算，选择理由待确认')})
    industry=basis.get('profile',{}).get('industry')
    return {**copy.deepcopy(action),'status':'proposed','objective':'contribution_margin','candidates':candidates,
        'choiceReason':action.get('reason') or action.get('whyFirst') or final['conclusion'],
        'rejectionReasons':rejected,
        'conditions':list(dict.fromkeys(conditions+([action['condition']] if action.get('condition') else []))),'confirmationStatus':'pending',
        'reviewWindow':{'status':'pending_confirmation','start':None,'end':None,'basisAsOf':scope['asOf'],'reason':'实际执行时间及未来观察成熟窗口尚待确认'},
        'observationMetrics':{'status':'proposed','industry':industry,'keys':['contributionMarginCents','fulfilled','unmet'],'unit':'房晚' if industry=='hotel' else '件','confirmationRequired':True},
        'evidenceIds':final.get('evidenceIds',[]),'claimIds':[c['id'] for c in claims],
        'calculationVersion':scope['operatingVersion'],'evidenceVersion':source_hash([scope,final.get('evidenceIds',[])]),
        'scenarioComparison':copy.deepcopy(scenario),'selectedIsExecuted':False,
        'executionInterface':'business-executions' if basis else 'decisions',
        'resultInterface':'business-outcomes' if basis else 'decisions',
        'knowledgeEligibility':{'status':'inactive','reason':'本轮建议处于待确认状态；形成长期经验须核验实际执行、成熟观察、归因与企业确认'}}

def hypothesis_records(final,claims):
    """Keep possible explanations, applicability, counterevidence and gaps."""
    return [{'statement':text,'status':'unconfirmed','supportStatus':next((c['status'] for c in claims if c['statement']==text),'insufficient'),
        'evidenceIds':final.get('evidenceIds',[]),'counterevidence':[v for c in claims for v in c['counterevidence']],
        'gaps':final.get('gaps',[]),'confirmationRequired':True} for text in final.get('alternatives',[])]

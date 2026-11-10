"""Offline frozen-case transport evaluation. Never a model or business quality score.

Inputs are produced by the TS calculators from distinct structured records.
The deterministic adapter tests the actual graph, publication and durable journal.
No preconstructed finished assessment is submitted. Semantic ratings stay pending.
"""
import asyncio,hashlib,json,copy
from pathlib import Path
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from .job_queue import JobQueue
from .runner import run_once
from .engine import source_hash
from .operating_reviews import grounded_review
from .knowledge_monitor import validate_extraction

def knowledge_fixture(item,native=None):
    """One offline/provider adapter preserving prepared enterprise/source identity."""
    ident=item['id'];context=item['context'];prepared=item.get('job',{})
    business=item.get('businessId') or prepared.get('businessId')
    if not isinstance(business,str) or not business:raise ValueError('Prepared knowledge enterprise identity is missing')
    state=item.get('fixtureReference',{}).get('calculationInput') or prepared.get('envelope',{}).get('operatingBasis',{}).get('queryData',{})
    scope=copy.deepcopy(item.get('knowledgeScope'))
    if scope is None:
        entities=list(dict.fromkeys(r['entityId'] for r in state.get('inputs',state.get('records',[])) if r.get('entityId')))
        if not entities:raise ValueError('Prepared knowledge scope is missing')
        scope={'entities':entities,'asOf':state.get('asOf','2026-09-30')}
    native=native or item.get('nativeDocument');source=copy.deepcopy(native.get('document')) if native else None
    if native and not source:raise ValueError('Unreadable document cannot become an extraction request')
    document={'id':'document-'+ident,'sourceId':'source-'+ident,'sourceVersion':1,'originalId':'official-'+ident}
    if source:
        document.update({k:v for k,v in source.items() if k in ('id','sourceId','sourceVersion','originalId','publishedAt','retrievedAt')});document['version']=source.get('version') or source['contentHash']
        document['paragraphs']=[{'index':r['index'],'text':r['text']} for r in source['paragraphs']]
        # Native reader metadata is retained exactly as provenance, separate
        # from the strict production Document schema and enterprise applicability.
        scope['documentProvenance']=source
    else:document.update(version=hashlib.sha256(context.encode()).hexdigest(),publishedAt=None,retrievedAt='2026-10-08T01:00:00+08:00',paragraphs=[{'index':0,'text':context}])
    job={'id':'frozen-'+ident,'businessId':business,'dataNature':item.get('dataNature',prepared.get('dataNature','demo')),'purpose':'knowledge','taskType':'DOCUMENT','document':document,'configuration':copy.deepcopy(item.get('knowledgeConfiguration') or {'region':state.get('profile',{}).get('region','浙江'),'objectives':[{'id':'objective','version':'1','statement':'核对适用范围'}],'constraints':[]}), 'scope':scope}
    if item.get('inputVersion')=='frozen-input-materials-v2':
        if item.get('documentDispositionVersion')!='document-disposition-v1':raise ValueError('New material requests require the explicit document disposition protocol')
        if not source:raise ValueError('New material requests require a native document')
        job['id']+='-materials-v2'
        job['documentDispositionVersion']=item['documentDispositionVersion']
        # Source bundles retain independently read versions and exact native paragraph locators.
        job['scope']['sourceProvenance']=[{k:copy.deepcopy(s.get(k)) for k in ('id','version','url','title','issuer','kind','publicationStatus','publishedAt','originalId','contentHash','retrievedAt')} for s in native['sources']]
        job['scope']['sourceRelations']=copy.deepcopy(native['sourceRelations'])
        job['scope']['paragraphLocators']=copy.deepcopy(native['paragraphLocators'])
        job['scope']['contextRecords']=copy.deepcopy(native['contextRecords'])
        job['scope']['materialVersion']=item['inputVersion']
        job['scope']['materialHash']=native['materialHash']
    if item.get('businessId'):assert job['businessId']==item['businessId']
    if prepared.get('businessId'):assert job['businessId']==prepared['businessId']
    if source:
        assert job['scope']['documentProvenance']==source
        for key in ('retrievedAt','publishedAt'):
            if key in source:assert job['document'][key]==source[key]
        assert job['document']['paragraphs']==[{'index':r['index'],'text':r['text']} for r in source['paragraphs']]
    if item.get('knowledgeScope'):
        for key,value in item['knowledgeScope'].items():assert job['scope'][key]==value
    claim={'statement':context,'paragraphIndices':[0],'region':'广东' if ident=='knowledge-wrong_region' else None,'effectiveAt':'2026-11-01' if ident=='knowledge-effective_future' else None,'expiresAt':'2026-10-07' if ident=='knowledge-expired' else None,'limitations':['离线合成段落，只验证协议及边界'],'applicability':'conflict' if ident=='knowledge-conflict' else 'unknown','relations':[],'impact':'企业影响需要另行核对','urgency':'normal','deadline':None,'actionability':'research','classification':'research','reason':'企业适用条件尚未确认','entities':[]}
    return job,{'claims':[claim]}

class OfflineKnowledgeModel:
    name='offline-knowledge-protocol-only'
    def __init__(self,value):self.value=value
    async def call(self,messages,tools=None):
        if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
            assert 'json' in messages[0]['content'].lower()
            payload=json.loads(messages[1]['content']);content={'claims':[{'i':i,'s':'I','r':[],'c':[],'g':['离线协议夹具未做模型语义判断']} for i,_ in enumerate(payload['statements'])]}
        else:content=self.value
        return {'role':'assistant','content':json.dumps(content,ensure_ascii=False)},{'prompt_tokens':100,'completion_tokens':100,'total_tokens':200}

class OfflineTransportModel:
    name='offline-calculation-transport-only'
    async def call(self,messages,tools=None):
        payload=json.loads(messages[1]['content'])
        if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
            # Explicit fake checker: checks protocol only; never a quality score.
            refs=payload['evidence'];content={'claims':[{'i':i,'s':'S' if refs else 'I','r':[0] if refs else [],'c':[],'g':[]} for i,_ in enumerate(payload['statements'])]}
        else:
            metrics=payload['basis']['metrics'];key=next((k for k,m in metrics.items() if m.get('value') is not None),None)
            content={'headline':'固定资料已读取','explanation':'请核对当前资料与适用范围。','claims':[{'metricKey':key,'value':metrics[key]['value']}] if key else [],'evidenceIds':['metric:'+key] if key else [],'confirmations':[], 'nextAction':{'title':'核对资料','reason':'需要核对适用范围','condition':'资料核实后继续'},'limitations':[],'selectedSourceIds':[]}
        return {'role':'assistant','content':json.dumps(content,ensure_ascii=False)},{'prompt_tokens':100,'completion_tokens':100,'total_tokens':200}

async def run_frozen(inputs,out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    q=JobQueue(out/'jobs.sqlite');q.initialize();rows=[]
    async with AsyncSqliteSaver.from_conn_string(str(out/'checkpoints.sqlite')) as saver:
        for item in inputs['cases']:
            if item['category']=='conversation':
                evidence=next(r for r in inputs['dialogueEvidence'] if r['id']==item['id'])
                rows.append({'id':item['id'],'category':'conversation','track':evidence['track'],'apiAssertions':evidence['assertions'],'caseExecution':evidence['status'],'runtimeStatus':'not_applicable_API_state_test','runtimeScopePassed':evidence['status']=='passed','invalidNumberRejected':True,'calculatorAssertions':[],'expectationCoverage':evidence['notCovered'],'scores':None,'online':'not_executed','human':'pending_human_review'})
                continue
            is_knowledge=item['category']!='diagnosis'
            native=next((r for r in inputs.get('knowledgeEvidence',[]) if r['id']==item['id']),None)
            if is_knowledge and item['id']=='knowledge-unreadable':
                rows.append({'id':item['id'],'category':'knowledge','track':'native_source_reader_no_extraction_on_unreadable','nativeAssertions':native['assertions'],'caseExecution':native['status'],'runtimeStatus':'blocked_unreadable_native','runtimeScopePassed':native['status']=='passed','invalidNumberRejected':True,'calculatorAssertions':[],'expectationCoverage':native['unsupportedExpectations'],'scores':None,'online':'not_executed','human':'pending_human_review'});continue
            j,value=knowledge_fixture(item,native) if is_knowledge else (item['job'],None)
            directory=out/item['id'];directory.mkdir(exist_ok=True)
            (directory/'request.json').write_text(json.dumps(j,ensure_ascii=False,indent=2))
            q.submit(j,source_hash(j));await run_once(q,'offline-frozen-worker',saver,model_factory=(lambda:OfflineKnowledgeModel(value)) if is_knowledge else OfflineTransportModel,poll_seconds=.005)
            observed=q.observe(j['id']);(directory/'result.json').write_text(json.dumps(observed,ensure_ascii=False,indent=2))
            a=(observed.get('result') or {}).get('businessAssessment')
            scope_ok=(observed['status']=='completed' and observed['result']['documentId']==j['document']['id'] and observed['result']['documentVersion']==j['document']['version']) if is_knowledge else bool(a and a['scope']['businessId']==j['businessId'] and a['scope']['dataNature']==j['dataNature'] and a['scope']['inputId']==j['snapshotId'] and a['scope']['asOf']==j['envelope']['snapshot']['asOf'])
            bad_number_rejected=False
            if is_knowledge:
                local=validate_extraction(value,j)['claims'][0];checks=[{'name':'unknown_applicability_quarantined','passed':not local['applicabilityVerified']},{'name':'exact_document_version','passed':local['documentVersion']==j['document']['version']}]
                invalid=__import__('copy').deepcopy(value);invalid['claims'][0]['paragraphIndices']=[999]
                try:validate_extraction(invalid,j)
                except ValueError:bad_number_rejected=True
                if item['id']=='knowledge-effective_future':checks.append({'name':'future_planning_only','passed':local['temporalUse']=='future_planning'})
                if item['id']=='knowledge-expired':checks.append({'name':'expiry_blocks_action','passed':local['classification']=='ignore' and local['actionability']=='none'})
                basis={'metrics':{}}
            else:checks=[];basis=j['envelope']['operatingBasis']
            if native:checks+=native['assertions']
            checks+=item.get('deterministicAssertions',[])
            key=next((k for k,m in basis['metrics'].items() if m.get('value') is not None),None)
            if key:
                bad={'headline':'核对资料','explanation':'当前资料需要核对。','claims':[{'metricKey':key,'value':basis['metrics'][key]['value']+1}],'evidenceIds':['metric:'+key],'confirmations':[],'nextAction':{'title':'核对资料','reason':'待核对','condition':'核对后继续'},'limitations':[],'selectedSourceIds':[]}
                try:grounded_review(bad,basis,[])
                except ValueError:bad_number_rejected=True
            with q.db() as db:
                journal=[dict(r) for r in db.execute('SELECT * FROM model_calls WHERE job_id=?',(j['id'],)).fetchall()]
            (directory/'call-journal.json').write_text(json.dumps(journal,ensure_ascii=False,indent=2))
            rows.append({'id':item['id'],'category':item['category'],'caseExecution':'passed' if observed['status']=='completed' and scope_ok and bad_number_rejected and all(x['passed'] for x in checks) else 'failed','nativeAssertions':checks,'fixtureHash':source_hash(j.get('envelope',j.get('document'))),'businessId':j['businessId'],'runtimeStatus':observed['status'],'runtimeScopePassed':scope_ok,'invalidNumberRejected':bad_number_rejected,'calculatorAssertions':[] if is_knowledge else item['calculatorAssertions'],'expectationCoverage':item['expectationCoverage'],'semanticExpectedBehavior':'pending_online_and_human_review','offlineAdapter':'deterministic_transport_not_diagnosis_quality','evidence':str(directory),'scores':None,'notApplicableDimensions':item['notApplicableDimensions'],'online':'not_executed','human':'pending_human_review'})
    q.initialize();recovered=q.recover();idle=q.claim('after-restart') is None
    return {'track':'offline_runtime_transport_and_calculator_assertions','frozenHash':inputs['frozenHash'],'lineage':inputs['lineage'],'caseCount':len(rows),'runtimeCompleted':sum(r['runtimeStatus']=='completed' for r in rows),'casesExecuted':sum(r['caseExecution']=='passed' for r in rows),'apiCasesPassed':sum(r.get('category')=='conversation' and r['caseExecution']=='passed' for r in rows),'calculatorAnchorFailures':sum(not a['passed'] for r in rows for a in r['calculatorAssertions'] if a['status']=='executed'),'unsupportedAnchors':sum(a['status']=='unsupported' for r in rows for a in r['calculatorAssertions']),'scopeFailures':sum(not r['runtimeScopePassed'] for r in rows),'numericFenceFailures':sum(not r['invalidNumberRejected'] for r in rows),'restart':{'recovered':recovered,'completedRemainIdle':idle},'qualityGate':'pending_online_and_human_review','meanScore':None,'cases':rows}

def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('input');parser.add_argument('out');args=parser.parse_args()
    value=json.loads(Path(args.input).read_text());result=asyncio.run(run_frozen(value,args.out));Path(args.out,'offline-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='cases'},ensure_ascii=False))
    if result['casesExecuted']!=60 or result['scopeFailures'] or result['numericFenceFailures'] or result['calculatorAnchorFailures']:raise SystemExit(1)
if __name__=='__main__':main()

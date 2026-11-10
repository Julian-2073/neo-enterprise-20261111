"""Opt-in provider evaluation on committed synthetic inputs. No automatic rating/retry."""
import argparse,asyncio,copy,json,os,subprocess
from pathlib import Path
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from .frozen_evaluation import knowledge_fixture
from .execution import SingleAttemptModel,ExecutionError,ModelRejected,reserve_input
from .engine import source_hash
from .job_queue import JobQueue,usage_tokens,DEFAULT_LIMITS
from .task_plan import task_limits
from .runner import run_once

def freeze_provider_job(template,model_name):
    """Bind actual model before enqueue/hash; never mutate prepared fixture."""
    job=copy.deepcopy(template)
    basis=job.get('envelope',{}).get('operatingBasis')
    if basis is not None:basis['modelIdentity']=model_name
    return job

def admitted_provider_limits(job,remaining_calls,remaining_tokens):
    """Explicit benchmark command-line limits are separate from unlimited app runtime."""
    limits=task_limits(job,DEFAULT_LIMITS)
    limits['maxModelCalls']=remaining_calls
    limits['maxTokens']=remaining_tokens
    limits['completionTokens']=6000
    return limits

def execution_lineage():
    root=Path(__file__).resolve().parents[2]
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    code="import {stableSource} from './scripts/stable-source.mjs';console.log((await stableSource()).digest)"
    digest=subprocess.check_output(['node','--input-type=module','-e',code],cwd=root,text=True).strip()
    return {'head':head,'sourceDigest':digest,'executionMode':'provider_runtime_synthetic','model':os.getenv('LLM_MODEL')}

async def evaluate(inputs,out,case_ids,limit,max_calls,max_tokens):
    out=Path(out);out.mkdir(parents=True,exist_ok=False)
    queue=JobQueue(out/'jobs.sqlite');queue.initialize()
    selected=[r for r in inputs['cases'] if not case_ids or r['id'] in case_ids][:limit]
    if case_ids-set(r['id'] for r in inputs['cases']):raise ValueError('Unknown frozen case IDs')
    totals={'invocations':0,'reportedTokens':0,'completed':0,'knownRejected':0,'unknown':0,'reservedUnknownTokens':0,'reservations':[]}
    class BoundedProvider(SingleAttemptModel):
        async def call(self,messages,tools=None):
            if totals['unknown']:raise ModelRejected('评估未发出请求：前次使用量或完成状态未知')
            if totals['invocations']>=max_calls:raise ModelRejected('评估未发出请求：总调用上限已到')
            if totals['reportedTokens']>=max_tokens:raise ModelRejected('评估未发出请求：已报告 token 上限已到')
            reserve,_,basis=reserve_input(messages,tools,[])
            reserve+=self.completion_tokens or 0
            if totals['reportedTokens']+totals['reservedUnknownTokens']+reserve>max_tokens:raise ModelRejected('评估未发出请求：下一调用保守预留超过总 token 上限')
            allocation={'invocation':totals['invocations']+1,'reservedTokens':reserve,'basis':basis,'state':'reserved'}
            totals['reservations'].append(allocation)
            totals['invocations']+=1
            try:
                result,usage=await super().call(messages,tools)
                totals['completed']+=1
                count=usage_tokens(usage)
                if count is None:
                    totals['unknown']+=1;totals['reservedUnknownTokens']+=reserve;allocation['state']='usage_unknown'
                else:
                    totals['reportedTokens']+=count;allocation.update(state='completed',reportedTokens=count)
                    if count>reserve:totals['unknown']+=1;allocation['state']='provider_usage_exceeded_reservation_stop'
                return result,usage
            except ExecutionError as e:
                rejected=e.code=='MODEL_REJECTED'
                totals['knownRejected' if rejected else 'unknown']+=1
                allocation['state']='known_rejected' if rejected else 'uncertain'
                if not rejected:totals['reservedUnknownTokens']+=reserve
                raise
    receipt={'track':'actual_provider_Runtime_on_synthetic_frozen_fixtures','frozenHash':inputs['frozenHash'],'lineage':inputs['lineage'],'executionLineage':execution_lineage(),'model':os.getenv('LLM_MODEL'),'maxTotalCalls':max_calls,'maxReportedTokens':max_tokens,'tokenLimitNotice':'conservative UTF8 input + completion reservation before every HTTP; any uncertain or missing reported usage stops subsequent calls','totals':totals,'qualityGate':'pending_model_assisted_and_human_review','meanScore':None,'cases':[{'id':r['id'],'status':'not_executed','scores':None,'human':'pending_human_review','notApplicableDimensions':r.get('notApplicableDimensions',[])} for r in inputs['cases']]}
    def save(): (out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
    save()
    async with AsyncSqliteSaver.from_conn_string(str(out/'checkpoints.sqlite')) as saver:
        for item in selected:
            row=next(r for r in receipt['cases'] if r['id']==item['id']);row.update(category=item['category'],expectationCoverage=item['expectationCoverage'],unsupportedExpectations=item['unsupportedExpectations'],turns=[])
            directory=out/item['id'];directory.mkdir();(directory/'fixture-lineage.json').write_text(json.dumps(item,ensure_ascii=False,indent=2))
            if totals['unknown'] or totals['invocations']>=max_calls or totals['reportedTokens']>=max_tokens:
                row['status']='not_executed_budget';save();continue
            native=item.get('nativeDocument')
            if native and not native['document']:
                row.update(status='blocked_unreadable_native_no_provider_request',nativeAssertions=native['assertions']);save();continue
            sequence=[knowledge_fixture(item)[0]] if item['category']=='knowledge' else item['jobSequence']
            prior=[]
            for index,template in enumerate(sequence):
                job=freeze_provider_job(template,os.getenv('LLM_MODEL',''))
                limits=admitted_provider_limits(job,max_calls-totals['invocations'],max_tokens-totals['reportedTokens']-totals['reservedUnknownTokens'])
                if job.get('purpose')!='knowledge':job['budget']={**(job.get('budget') or {}),**limits}
                if item['category']=='conversation':
                    job['envelope']['conversation']['history']=copy.deepcopy(prior)
                    # Real previous result is carried as history, never as current facts.
                    job['envelope']['conversation']['summary']=[{'runId':t['runId'],'inputId':t['inputId'],'evidenceStatus':'historical_not_current'} for t in row['turns']]
                (directory/f'turn-{index}-admission-lineage.json').write_text(json.dumps({'preparedRequestHash':source_hash(template),'preparedModelIdentity':template.get('envelope',{}).get('operatingBasis',{}).get('modelIdentity'),'admittedModelIdentity':job.get('envelope',{}).get('operatingBasis',{}).get('modelIdentity'),'admittedRequestHash':source_hash(job),'executionLineage':receipt['executionLineage']},ensure_ascii=False,indent=2))
                (directory/f'turn-{index}-request.json').write_text(json.dumps(job,ensure_ascii=False,indent=2))
                queue.submit(job,source_hash(job));await run_once(queue,'frozen-provider',saver,model_factory=lambda:BoundedProvider(limits['completionTokens']),poll_seconds=.1)
                observed=queue.observe(job['id']);(directory/f'turn-{index}-result.json').write_text(json.dumps(observed,ensure_ascii=False,indent=2))
                with queue.db() as db:journal=[dict(r) for r in db.execute('SELECT * FROM model_calls WHERE job_id=? ORDER BY started_at',(job['id'],)).fetchall()]
                (directory/f'turn-{index}-call-journal.json').write_text(json.dumps(journal,ensure_ascii=False,indent=2))
                row['turns'].append({'runId':job['id'],'inputId':job.get('snapshotId',job.get('document',{}).get('id')),'status':observed['status'],'errorCode':observed.get('errorCode'),'requestHash':source_hash(job),'evidence':str(directory),'observability':observed.get('observability')})
                prior.extend([{'role':'user','content':job.get('question','')},{'role':'assistant','content':json.dumps({'runId':job['id'],'inputId':job.get('snapshotId'),'notice':'历史结果须重新核对，不是当前事实','result':observed.get('result')},ensure_ascii=False)}])
                row['status']='provider_completed_semantic_review_pending' if observed['status']=='completed' else 'failed_or_partial';save()
                if observed['status']!='completed':break
    save();return receipt

def main():
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('out');p.add_argument('--execute',action='store_true');p.add_argument('--cases',default='');p.add_argument('--limit',type=int,default=3);p.add_argument('--max-total-calls',type=int,default=12);p.add_argument('--max-total-tokens',type=int,default=120000);a=p.parse_args()
    value=json.loads(Path(a.input).read_text());expected='832f078da40fff0751e9f1bc18d69f56e0d2960e4b7e6555fe148ade31c611f7'
    if value['frozenHash']!=expected or len(value['cases'])!=60:raise SystemExit('Frozen input receipt invalid')
    if not a.execute:print(json.dumps({'status':'prepared_not_executed','cases':60,'providerCalls':0}));return
    if not os.getenv('LLM_API_KEY') or not os.getenv('LLM_MODEL'):raise SystemExit('Configure LLM_API_KEY and LLM_MODEL explicitly')
    if not 1<=a.limit<=60 or not 1<=a.max_total_calls<=512 or not 1<=a.max_total_tokens<=12000000:raise SystemExit('Evaluation cap invalid')
    result=asyncio.run(evaluate(value,a.out,set(filter(None,a.cases.split(','))),a.limit,a.max_total_calls,a.max_total_tokens));print(json.dumps({'out':a.out,'totals':result['totals'],'qualityGate':result['qualityGate']},ensure_ascii=False))
if __name__=='__main__':main()

import asyncio,json
import pytest
from langgraph.checkpoint.memory import MemorySaver
from neo_agent.agent import AgentRuntime
from neo_agent.runtime import NeoRuntime
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from neo_agent.task_plan import plan_task
from test_unified_runtime import job

class ReachedModel(Exception):pass
class StopModel:
    name='offline-regression'
    async def call(self,*args,**kwargs):raise ReachedModel()

@pytest.mark.parametrize('prepared',[False,True])
def test_nonempty_knowledge_reaches_model_without_set_catalog_failure(prepared):
    j=job(question='审查客户转化与供给问题',mode='conversion',purpose='home' if prepared else 'analysis')
    j['envelope']['knowledge']={'businessId':'b1','dataNature':'demo','capturedAt':'2026-10-07',
                               'pack':{'id':'pack:ecommerce','version':'1','rules':['4A 客户旅程']},'items':[],'rules':[]}
    async def run():
        if prepared:
            runtime=AgentRuntime(MemorySaver(),model=StopModel(),build_graph=False)
            await runtime.specialist({'job':j,'runtimePlan':plan_task(j),'runtimePrepared':True,'toolReads':[]},'orchestrator')
        else:
            await NeoRuntime(MemorySaver(),StopModel()).graph.ainvoke({'job':j},{'configurable':{'thread_id':'knowledge-regression'}})
    with pytest.raises(ReachedModel):asyncio.run(run())

def test_large_knowledge_audit_is_preserved_but_status_receipt_is_bounded(tmp_path):
    q=JobQueue(tmp_path/'agent.sqlite');q.initialize();j=job();q.submit(j,source_hash(j))
    body={'items':[{'statement':'政策原文'*20000}],'scope':{'businessId':'b1'}}
    with q.db() as c:q.event(c,j['id'],'tool_completed',{'tool':'read_knowledge','result':body})
    event=q.observe(j['id'])['observability']['events'][-1]
    assert 'result' not in event['data']
    assert event['data']['resultRef']['sha256']==source_hash(body)
    assert len(json.dumps(event).encode())<1000
    with q.db() as c:
        stored=c.execute('SELECT payload FROM run_events WHERE job_id=? AND seq=?',(j['id'],event['data']['resultRef']['eventSequence'])).fetchone()
    assert json.loads(stored[0])['result']==body

def test_verified_claim_index_keeps_conditions_locators_and_immutable_original():
    from neo_agent.current_knowledge import model_knowledge_view
    paragraph={'index':2,'start':10,'end':110,'text':'完整原文'*100}
    original={'items':[{'id':'claim','documentId':'doc','statement':'已核验主张','paragraphs':[paragraph],
                        'support':[{'id':'doc:paragraph:2','exact':paragraph['text']}],
                        'supportStatus':'supported','applicabilityVerified':False,'limitations':['地区待确认']}],'rules':[]}
    view=model_knowledge_view(original);item=view['items'][0]
    assert item['statement']=='已核验主张' and item['limitations']==['地区待确认']
    assert item['applicabilityVerified'] is False
    assert item['paragraphReferences']==[{'id':'doc:paragraph:2','index':2,'start':10,'end':110}]
    assert view['delivery']=='verified_claim_index' and original['items'][0]['paragraphs'][0]==paragraph
    assert 'paragraphs' not in item and 'support' not in item

def test_shared_long_text_projection_is_lossless_and_compact():
    from neo_agent.agent import model_reference_data
    text='政策原文与全部支持信息'*2000
    raw={'paragraph':{'text':text},'support':[{'exact':text},{'exact':text}]}
    view=model_reference_data(raw);refs=view.get('contextRefs',{})
    def expand(v):
        if isinstance(v,dict) and set(v)=={'sameAsContextRef'}:return expand(refs[v['sameAsContextRef']])
        if isinstance(v,dict):return {k:expand(x) for k,x in v.items() if k!='contextRefs'}
        if isinstance(v,list):return [expand(x) for x in v]
        return v
    assert expand(view)==raw
    assert len(json.dumps(view,ensure_ascii=False))<len(json.dumps(raw,ensure_ascii=False))/2

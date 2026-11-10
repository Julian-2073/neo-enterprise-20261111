"""Frozen new protocol and legacy recovery; scripted transport, zero paid calls."""
import asyncio,copy,json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.knowledge_monitor import KnowledgeJob,KnowledgeRuntime,validate_extraction
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from neo_agent.runner import run_once
from test_knowledge_monitor import job

def fixture(classification='research'):
    j=job('disposition');j['documentDispositionVersion']='document-disposition-v1'
    j['document']['paragraphs']=[{'index':7,'text':'本页只是规则发布消息，未载具体适用条款，企业范围也尚未确认。'},{'index':11,'text':'不可据此确认企业资格或生效日期。'}]
    return j,{'claims':[],'documentDisposition':{'classification':classification,'reason':'本分节未载具体条款，企业适用范围待核。','paragraphIndices':[7],'gaps':['缺少具体适用条款']}}

@pytest.mark.parametrize('classification',['ignore','monitor','research','affects_assessment'])
def test_empty_claims_still_check_supported_document_reason_and_exact_versions(classification):
    j,v=fixture(classification);calls=[]
    class Model:
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);calls.append(p)
            assert p['expectedCount']==1 and len(p['evidence'])==2
            assert [r['exact'] for r in p['evidence']]==[x['text'] for x in j['document']['paragraphs']]
            return {'content':json.dumps({'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[]}]})},{}
    r=asyncio.run(KnowledgeRuntime(None,Model()).verify({'job':j,'extracted':validate_extraction(v,j)}))['result']
    d=r['documentDisposition'];assert len(calls)==1 and r['claims']==[]
    assert d['classification']==('research' if classification=='affects_assessment' else classification)
    assert d['supportStatus']=='supported' and d['sourceVersion']=='1' and d['configurationVersion']==1
    assert d['coverage']['processedParagraphIndices']==[7,11] and d['coverage']['scope']=='provided_section_only'
    assert d['support'][0]['id']=='d:paragraph:7' and d['support'][0]['exact']==j['document']['paragraphs'][0]['text']
    assert d['support'][0]['documentVersion']=='hash'

@pytest.mark.parametrize('status',['I','C'])
def test_unsupported_or_conflicting_reason_is_only_research_with_counterparagraph(status):
    j,v=fixture('ignore')
    class Model:
        async def call(self,*args):return {'content':json.dumps({'claims':[{'i':0,'s':status,'r':[],'c':[1] if status=='C' else [],'g':['地区效期未验证']}]})},{}
    d=asyncio.run(KnowledgeRuntime(None,Model()).verify({'job':j,'extracted':validate_extraction(v,j)}))['result']['documentDisposition']
    assert d['classification']=='research' and d['proposedClassification']=='ignore'
    assert d['supportStatus']==('conflict' if status=='C' else 'insufficient')
    assert '地区效期未验证' in d['gaps']
    if status=='C':assert d['counterevidence'][0]['exact']==j['document']['paragraphs'][1]['text']

def test_new_reason_required_but_old_serialization_empty_result_and_successful_journal_remain_inert(tmp_path):
    j,v=fixture()
    with pytest.raises(ValueError):validate_extraction({'claims':[]},j)
    v['documentDisposition']['paragraphIndices']=[0]
    with pytest.raises(ValueError):validate_extraction(v,j)
    legacy=job();assert KnowledgeJob.model_validate(legacy).model_dump()==legacy
    class Forbidden:
        async def call(self,*args):raise AssertionError('old empty result must not be paid to backfill')
    old=asyncio.run(KnowledgeRuntime(None,Forbidden()).verify({'job':legacy,'extracted':{'claims':[]}}))['result']
    assert old=={'claims':[],'semanticValidation':{'version':'semantic-support-v1','status':'verified'},'documentId':'d','documentVersion':'hash'}
    q=JobQueue(tmp_path/'q');q.initialize();q.submit(legacy,source_hash(legacy));q.claim('owner',lane='background');q.finish(legacy['id'],'owner','completed',result=old)
    with q.db() as c:original=c.execute('SELECT result FROM jobs WHERE id=?',(legacy['id'],)).fetchone()[0]
    q.initialize();assert q.recover()==0
    async def replay():
        async with AsyncSqliteSaver.from_conn_string(q.path+'.cp') as saver:assert not await run_once(q,'worker',saver,model_factory=Forbidden,lane='background')
    asyncio.run(replay())
    with q.db() as c:assert c.execute('SELECT result FROM jobs WHERE id=?',(legacy['id'],)).fetchone()[0]==original
    assert 'documentDisposition' not in q.observe(legacy['id'])['result']

def test_reason_cannot_create_causality_or_policy_eligibility_even_with_permissive_checker():
    j,v=fixture('ignore');v['documentDisposition']['reason']='已确认符合政策适用条件，可申领补贴。'
    class Model:
        async def call(self,*args):return {'content':json.dumps({'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[]}]})},{}
    d=asyncio.run(KnowledgeRuntime(None,Model()).verify({'job':j,'extracted':validate_extraction(v,j)}))['result']['documentDisposition']
    assert d['classification']=='research' and d['supportStatus']=='insufficient'

@pytest.mark.parametrize('reason',['并非没有因果证据','不能证明停售不会导致退款','不能证明停售不足以导致退款','不能证明库存不足以造成退款','不能证明容量不够以引起退款'])
def test_document_reason_nested_denial_is_not_a_supported_classification_exemption(reason):
    j,v=fixture('ignore');v['documentDisposition']['reason']=reason
    class Model:
        async def call(self,*args):return {'content':json.dumps({'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[]}]})},{}
    d=asyncio.run(KnowledgeRuntime(None,Model()).verify({'job':j,'extracted':validate_extraction(v,j)}))['result']['documentDisposition']
    assert d['classification']=='research' and d['supportStatus']=='insufficient'
    assert d['reason']==reason

def test_new_empty_job_uses_shared_graph_journal_finite_repair_and_native_caps(tmp_path):
    j,v=fixture();q=JobQueue(tmp_path/'q');q.initialize();q.submit(j,source_hash(j));checks=[]
    class Model:
        name='offline-new-document-protocol'
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                checks.append(messages)
                rows=[] if len(checks)==1 else [{'i':0,'s':'S','r':[0],'c':[],'g':[]}]
                return {'content':json.dumps({'claims':rows})},{'total_tokens':80}
            assert 'documentDisposition' in messages[0]['content']
            return {'content':json.dumps(v,ensure_ascii=False)},{'total_tokens':80}
    async def run():
        async with AsyncSqliteSaver.from_conn_string(q.path+'.cp') as saver:await run_once(q,'worker',saver,model_factory=Model,lane='background')
    asyncio.run(run());r=q.observe(j['id']);assert r['status']=='completed',r
    assert r['result']['semanticValidation']['formatRepairs']==1
    assert r['observability']['modelInvocations']==3 and r['observability']['limits']['maxModelCalls'] is None and r['observability']['limits']['maxTokens'] is None
    q.initialize();q.recover();assert q.claim('another',lane='background') is None

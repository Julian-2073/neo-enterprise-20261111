"""Actual graph/journal protocol regressions. Scripted transport, no semantic score."""
import asyncio,copy,json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.knowledge_monitor import KnowledgeRuntime,validate_extraction
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from neo_agent.execution import ModelRejected
from neo_agent.claim_support import decode_compact_claims
from neo_agent import runner
from test_knowledge_monitor import job,extraction

def eight_claim_fixture():
    j=job('eight-claims');j['document']['paragraphs']=[{'index':i,'text':f'第{i}款：本规则仅描述室内固定式健身器材的事项{i}。原文现时读取，企业范围尚未确认。'+('核对安全标准的适用产品、限制条件以及生效时间。'*8)} for i in range(20)]
    v=extraction();v['claims']=[{**copy.deepcopy(v['claims'][0]),'statement':f'本规则仅描述室内固定式健身器材的事项{i}。','paragraphIndices':[i]} for i in range(8)]
    return j,v

def batch_response(payload,reverse=True,missing=False):
    count=payload['expectedCount'];rows=[{'i':i,'s':'I','r':[],'c':[],'g':['边界'+str(payload['statements'][i]['globalIndex'])]} for i in range(count)]
    return {'content':json.dumps({'claims':list(reversed(rows[:-1] if missing else rows)) if reverse else rows},ensure_ascii=False)}

@pytest.mark.parametrize('repair_first',[False,True])
def test_eight_claims_keep_every_exact_paragraph_and_bind_reversed_rows_under_native_caps(tmp_path,repair_first):
    j,v=eight_claim_fixture();q=JobQueue(tmp_path/'q');q.initialize();q.submit(j,source_hash(j));payloads=[];extracts=[]
    class Model:
        name='bounded-eight-claim-protocol'
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                p=json.loads(messages[1]['content']);payloads.append(p)
                assert 'JSON' in messages[0]['content'] and '完整原段落' in messages[0]['content']
                assert p['expectedCount']<=12 and p['requiredIndices']==list(range(p['expectedCount']))
                assert p['evidenceCoverage']['complete'] and p['evidenceCoverage']['omittedParagraphs']==0
                assert [r['exact'] for r in p['evidence'] if r['kind']=='paragraph']==[p['text'] for p in j['document']['paragraphs']]
                assert all(set(r)=={'i','kind','exact'} for r in p['evidence'])
                return batch_response(p,missing=repair_first and len(payloads)==1),{'total_tokens':3000,'prompt_tokens':2500,'completion_tokens':500}
            extracts.append(messages);return {'content':json.dumps(v,ensure_ascii=False)},{'total_tokens':5545,'prompt_tokens':4226,'completion_tokens':1319}
    async def run():
        async with AsyncSqliteSaver.from_conn_string(q.path+'.cp') as saver:await runner.run_once(q,'worker',saver,model_factory=Model,poll_seconds=.01)
    asyncio.run(run());r=q.observe(j['id']);assert r['status']=='completed',r
    assert len(extracts)==1 and len(payloads)==3+int(repair_first)
    validation=r['result']['semanticValidation'];assert validation['statementCount']==32 and validation['batchSizes']==[12,12,8] and validation['formatRepairs']==int(repair_first)
    for i,c in enumerate(r['result']['claims']):assert c['gaps']==['边界'+str(k) for k in range(i*4,i*4+4)]
    assert r['observability']['limits']['maxTokens'] is None and r['observability']['limits']['maxModelCalls'] is None
    assert r['observability']['modelInvocations']==4+int(repair_first) and r['observability']['reportedTokens']<60000

def test_second_malformed_batch_fails_after_single_format_repair_without_padding(tmp_path):
    j,v=eight_claim_fixture();calls=[]
    class Model:
        name='bad-batch-protocol'
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);calls.append(p)
            # Repair first batch successfully, then fail a second batch.
            return batch_response(p,missing=len(calls)!=2),{}
    async def run():
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp')) as saver:
            with pytest.raises(Exception,match='知识支持校验格式'):
                await KnowledgeRuntime(saver,Model()).verify({'job':j,'extracted':validate_extraction(v,j)})
    asyncio.run(run());assert len(calls)==3 and [p['expectedCount'] for p in calls]==[12,12,12]

def test_last_explicit_resume_reuses_extraction_after_known_reject_and_old_incomplete_checker(tmp_path,monkeypatch):
    j,v=eight_claim_fixture();q=JobQueue(tmp_path/'q');q.initialize();q.submit(j,source_hash(j));extracts=[];old_checks=[];new_checks=[]
    class Model:
        name='unchanged-production-model-name'
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                p=json.loads(messages[1]['content'])
                if 'expectedCount' in p:new_checks.append(p);return batch_response(p),{'total_tokens':3000,'prompt_tokens':2500,'completion_tokens':500}
                old_checks.append(p)
                if len(old_checks)==1:raise ModelRejected('fixture known HTTP400 reject')
                return {'content':json.dumps({'claims':[{'i':i,'s':'I','r':[],'c':[],'g':[]} for i in range(27)]})},{'total_tokens':10833,'prompt_tokens':9930,'completion_tokens':903}
            extracts.append(messages);return {'content':json.dumps(v,ensure_ascii=False)},{'total_tokens':5545,'prompt_tokens':4226,'completion_tokens':1319}
    class OldVerificationRuntime(KnowledgeRuntime):
        async def verify(self,state):
            response,_=await self.model.call([{'role':'system','content':'NEO_SEMANTIC_SUPPORT_CHECK old unbatched JSON'},{'role':'user','content':json.dumps({'statements':list(range(32))})}])
            decode_compact_claims(json.loads(response['content']),{}, {},32)
            raise AssertionError('Old incomplete output must fail')
    async def run():
        async with AsyncSqliteSaver.from_conn_string(q.path+'.cp') as saver:
            monkeypatch.setattr(runner,'KnowledgeRuntime',OldVerificationRuntime)
            await runner.run_once(q,'worker',saver,model_factory=Model,poll_seconds=.01);assert q.observe(j['id'])['status']=='failed'
            q.resume(j['id']);await runner.run_once(q,'worker',saver,model_factory=Model,poll_seconds=.01);assert q.observe(j['id'])['status']=='failed'
            assert len(extracts)==1 and len(old_checks)==2
            assert q.observe(j['id'])['observability']['attemptCount']==2
            monkeypatch.setattr(runner,'KnowledgeRuntime',KnowledgeRuntime)
            q.resume(j['id']);await runner.run_once(q,'worker',saver,model_factory=Model,poll_seconds=.01)
    asyncio.run(run());r=q.observe(j['id']);assert r['status']=='completed',r
    assert len(extracts)==1 and len(old_checks)==2 and len(new_checks)==3
    assert r['observability']['attemptCount']==3 and r['observability']['modelInvocations']==6
    assert r['observability']['reportedTokens']==16378+9000 and r['observability']['limits']['maxModelCalls'] is None

def test_conflicts_in_later_batch_keep_exact_counterparagraph_and_document_version():
    j,v=eight_claim_fixture()
    class Model:
        name='counter-batch-protocol'
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);rows=[]
            for x in p['statements']:
                rows.append({'i':x['i'],'s':'C','r':[],'c':[19],'g':[]})
            return {'content':json.dumps({'claims':rows})},{'total_tokens':500}
    value=validate_extraction(v,j)
    result=asyncio.run(KnowledgeRuntime(None,Model()).verify({'job':j,'extracted':value}))['result']
    assert result['semanticValidation']['batchSizes']==[12,12,8]
    for claim in result['claims']:
        assert claim['supportStatus']=='conflict' and claim['classification']=='research'
        assert all(r['id']==j['document']['id']+':paragraph:19' and r['exact']==j['document']['paragraphs'][19]['text'] and r['documentVersion']==j['document']['version'] for r in claim['counterevidence'])
        assert len(claim['counterevidence'])==4

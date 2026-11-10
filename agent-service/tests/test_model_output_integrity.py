import asyncio,json
import httpx,pytest
from neo_agent.execution import SingleAttemptModel,JournaledModel
from neo_agent.providers import Model
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from neo_agent.knowledge_monitor import KnowledgeRuntime
from test_knowledge_monitor import job


@pytest.mark.parametrize('adapter',[Model,SingleAttemptModel])
def test_provider_retains_finish_reason_and_usage_for_truncated_response(monkeypatch,adapter):
    monkeypatch.setenv('LLM_API_KEY','fixture-only')
    monkeypatch.setenv('LLM_MODEL','fixture')
    monkeypatch.setenv('LLM_BASE_URL','https://fixture.invalid/v1')
    def respond(request):
        return httpx.Response(200,json={'choices':[{'finish_reason':'length','message':{'role':'assistant','content':'{"claims":[]}'}}],'usage':{'completion_tokens':2000,'total_tokens':2100}})
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(respond),**kwargs))
    message,usage=asyncio.run(adapter().call([{'role':'user','content':'JSON'}]))
    assert message.get('_finish_reason')=='length'
    assert usage['completion_tokens']==2000


def test_document_limits_are_unlimited_and_ignore_legacy_output_caps(tmp_path):
    q=JobQueue(tmp_path/'queue.sqlite');q.initialize();j=job();q.submit(j,source_hash(j))
    with q.db() as c:limits=json.loads(c.execute('SELECT limits_json FROM jobs').fetchone()[0])
    assert limits['completionTokens'] is None
    assert limits['maxTokens'] is None and limits['maxModelCalls'] is None
    # Legacy output caps no longer truncate application requests.
    smaller={**job('smaller'),'budget':{'completionTokens':1200}}
    q.submit(smaller,source_hash(smaller))
    with q.db() as c:assert json.loads(c.execute("SELECT limits_json FROM jobs WHERE id='smaller'").fetchone()[0])['completionTokens'] is None


def test_truncated_even_parseable_document_is_repaired_once_and_never_published(tmp_path):
    q=JobQueue(tmp_path/'queue.sqlite');q.initialize();j=job();q.submit(j,source_hash(j));q.claim('owner',lane='background')
    class Truncated:
        name='fixture';calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            return {'content':'{"claims":[]}','_finish_reason':'length'},{'total_tokens':10}
    delegate=Truncated();model=JournaledModel(q,j['id'],delegate,'owner');runtime=KnowledgeRuntime(None,model)
    with pytest.raises(ValueError,match='截断') as error:asyncio.run(runtime.extract({'job':j}))
    assert getattr(error.value,'code',None)=='MODEL_OUTPUT_INCOMPLETE'
    assert delegate.calls==2
    # Both HTTP replies were received: billed usage stays completed, not uncertain.
    with q.db() as c:assert [r[0] for r in c.execute('SELECT state FROM model_calls')]==['completed','completed']
    with pytest.raises(ValueError,match='截断'):asyncio.run(runtime.extract({'job':j}))
    assert delegate.calls==2,'checkpoint replay must not repeat received provider calls'


def test_incomplete_document_regenerates_from_same_source_without_padding():
    j=job()
    class Repair:
        calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            if self.calls==1:return {'content':'{"claims":[{"statement":"half','_finish_reason':'length'},{}
            assert json.loads(messages[1]['content'])==j
            assert all('half' not in m['content'] for m in messages)
            return {'content':'{"claims":[]}','_finish_reason':'stop'},{}
    model=Repair();result=asyncio.run(KnowledgeRuntime(None,model).extract({'job':j}))
    assert result=={'extracted':{'claims':[]}} and model.calls==2


@pytest.mark.parametrize('adapter',[Model,SingleAttemptModel])
def test_app_provider_request_has_no_output_token_budget(monkeypatch,adapter):
    monkeypatch.setenv('LLM_API_KEY','fixture-only')
    monkeypatch.setenv('LLM_MODEL','fixture')
    monkeypatch.setenv('LLM_BASE_URL','https://fixture.invalid/v1')
    payloads=[]
    def respond(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'{}'}}],'usage':{'total_tokens':900000}})
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(respond),**kwargs))
    message,usage=asyncio.run(adapter().call([{'role':'user','content':'JSON'}]))
    assert 'max_tokens' not in payloads[0] and 'max_completion_tokens' not in payloads[0]
    assert message['_finish_reason']=='stop' and usage['total_tokens']==900000

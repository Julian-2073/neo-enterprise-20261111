import asyncio
import pytest
import httpx
from neo_agent import execution

@pytest.mark.parametrize('body,reason',[
    ({'error':{'message':'Insufficient Balance (request_id: req-123)','code':'invalid_request_error'}},'Insufficient Balance'),
    ({'error':{'message':'The selected route is unavailable','code':'route_unavailable'}},'route_unavailable'),
])
def test_known_rejection_retains_provider_reason_and_never_retries(monkeypatch,body,reason):
    monkeypatch.setenv('LLM_API_KEY','offline-test-key')
    monkeypatch.setenv('LLM_MODEL','offline-model')
    calls=[]
    def respond(request):calls.append(request);return httpx.Response(402,json=body)
    original=httpx.AsyncClient
    monkeypatch.setattr(execution.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(respond),**kw))
    with pytest.raises(execution.ModelRejected) as failure:
        asyncio.run(execution.SingleAttemptModel().call([{'role':'user','content':'q'}]))
    assert reason in str(failure.value) and len(calls)==1
    assert failure.value.code=='MODEL_REJECTED'

def test_provider_reason_redacts_credential_and_does_not_infer_balance(monkeypatch):
    key='offline-test-key-secret';monkeypatch.setenv('LLM_API_KEY',key);monkeypatch.setenv('LLM_MODEL','offline-model')
    original=httpx.AsyncClient
    def respond(request):return httpx.Response(402,json={'error':{'message':'Route blocked: '+key+' Bearer other-secret','code':'route_blocked'}})
    monkeypatch.setattr(execution.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(respond),**kw))
    with pytest.raises(execution.ModelRejected) as failure:asyncio.run(execution.SingleAttemptModel().call([{'role':'user','content':'q'}]))
    text=str(failure.value);assert key not in text and 'other-secret' not in text and 'route_blocked' in text
    assert '余额不足' not in text

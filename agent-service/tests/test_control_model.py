import asyncio
import pytest
from types import SimpleNamespace
from neo_agent.control_model import configure_control_model
from neo_agent.execution import ExecutionError

def test_unconfigured_reference_does_not_replace_environment_model():
    async def scenario():
        model=SimpleNamespace(name='original',key='original-key',base='original-base')
        await configure_control_model(model,{'envelope':{}})
        assert model.name=='original'
    asyncio.run(scenario())

def test_scope_mismatch_and_unconfigured_endpoint_reject_before_calls(monkeypatch):
    async def scenario():
        job={'businessId':'a','dataNature':'demo','envelope':{'modelProfileRef':{'id':'model-1','businessId':'b','dataNature':'demo'}}}
        with pytest.raises(ExecutionError,match='范围不匹配'):
            await configure_control_model(SimpleNamespace(),job)
        job['envelope']['modelProfileRef']['businessId']='a'
        monkeypatch.delenv('NEO_CONTROL_URL',raising=False)
        with pytest.raises(ExecutionError,match='尚未配置'):
            await configure_control_model(SimpleNamespace(),job)
    asyncio.run(scenario())

def test_authenticated_resolver_selects_profile_in_memory(monkeypatch):
    async def scenario():
        monkeypatch.setenv('NEO_CONTROL_URL','http://127.0.0.1:3158')
        monkeypatch.setenv('NEO_SERVICE_TOKEN','private-service-token')
        import neo_agent.control_model as mod
        class Response:
            status_code=200
            def json(self):return {'model':'chosen-model','apiKey':'private-key','baseUrl':'https://api.deepseek.com/v1'}
        class Client:
            def __init__(self,**kwargs):assert kwargs['follow_redirects'] is False
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def get(self,url,params,headers):
                assert url.endswith('/resolve/model-1')
                assert params=={'businessId':'a','dataNature':'demo'}
                assert headers['Authorization']=='Bearer private-service-token'
                return Response()
        monkeypatch.setattr(mod.httpx,'AsyncClient',Client)
        ref={'id':'model-1','businessId':'a','dataNature':'demo'}
        job={'businessId':'a','dataNature':'demo','envelope':{'modelProfileRef':ref.copy()}}
        model=SimpleNamespace(name='old',key='old',base='old')
        await configure_control_model(model,job)
        assert model.name=='chosen-model' and model.key=='private-key'
        assert job['envelope']['modelProfileRef']==ref
    asyncio.run(scenario())

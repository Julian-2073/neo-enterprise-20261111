import asyncio
import httpx
import pytest
from neo_agent.execution import SingleAttemptModel
from neo_agent.providers import Model


@pytest.mark.parametrize('adapter', [SingleAttemptModel, Model])
def test_model_connection_ignores_unconfigured_system_proxy(monkeypatch, adapter):
    monkeypatch.setenv('LLM_API_KEY', 'offline-test-key')
    monkeypatch.setenv('LLM_MODEL', 'offline-model')
    discovered = []

    def system_proxies():
        discovered.append(True)
        return {'https': 'http://127.0.0.1:7890'}

    async def response(client, url, **kwargs):
        return httpx.Response(200, json={
            'choices': [{'message': {'role': 'assistant', 'content': '{"ok":true}'}}],
            'usage': {'completion_tokens': 4},
        })

    # Exercise real client construction: macOS proxy discovery happens there,
    # before any request. Only the outbound request is replaced for this test.
    monkeypatch.setattr(httpx._utils, 'getproxies', system_proxies)
    monkeypatch.setattr(httpx.AsyncClient, 'post', response)
    message, usage = asyncio.run(adapter().call([{'role': 'user', 'content': 'q'}]))
    assert message['content'] == '{"ok":true}'
    assert usage['completion_tokens'] == 4
    assert discovered == []

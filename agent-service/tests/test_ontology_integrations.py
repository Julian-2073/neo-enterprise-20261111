import asyncio,json
import pytest
from fastapi import HTTPException
from neo_agent import ontology_integrations as m

TARGET={'id':'product','name':'商品','primaryKey':'id','properties':{'id':{'type':'string','required':True},'name':{'type':'string'},'price':{'type':'number'}}}

def test_scope_names_keep_business_and_nature_separate():
    assert len({m.scope_name('a','demo'),m.scope_name('a','business'),m.scope_name('b','demo')})==3
    assert m.scope_name('a','demo')==m.scope_name('a','demo')


def test_disallowed_model_hosts_rejected_before_process(monkeypatch):
    monkeypatch.setattr(m,'PYTHON',m.Path(__file__))
    x=m.ExtractInput(text='商品',target=TARGET,model='openai/m',baseUrl='http://169.254.169.254')
    with pytest.raises(HTTPException) as err:asyncio.run(m.extract(x))
    assert err.value.status_code==422


def test_candidates_get_actual_source_evidence_missing_fields_and_no_invented_quotes(monkeypatch):
    monkeypatch.setattr(m,'PYTHON',m.Path(__file__))
    class Process:
        returncode=0
        async def communicate(self,stdin):
            assert json.loads(stdin)['target']['id']=='product'
            return json.dumps({'engine':'OntoGPT/SPIRES','objects':[{'id':None,'name':'蓝色杯','price':'199','source_quote':'虚构依据'}]}).encode(),b''
    async def spawn(*args,**kwargs):
        assert 'secret-value' not in str(args)
        assert kwargs['stderr']==asyncio.subprocess.DEVNULL
        return Process()
    monkeypatch.setattr(m.asyncio,'create_subprocess_exec',spawn)
    result=asyncio.run(m.extract(m.ExtractInput(text='蓝色杯价格为 99 元。',target=TARGET,model='ollama/qwen2.5:3b',baseUrl='http://127.0.0.1:11434')))
    candidate=result['objects'][0]
    assert candidate['sourceMatched']
    assert candidate['unsupportedFields']==['price']
    assert candidate['missingRequired']==['id']
    assert candidate['sourceQuote']=='蓝色杯价格为 99 元。'
    assert result['status']=='awaiting_review'
    assert candidate['fieldEvidence'][0]['field']=='name'


def test_invalid_output_cannot_be_saved_as_objects(monkeypatch):
    monkeypatch.setattr(m,'PYTHON',m.Path(__file__))
    class Process:
        returncode=0
        async def communicate(self,stdin):return b'{"objects":[{"invented":"property"}]}',b''
    async def spawn(*args,**kwargs):return Process()
    monkeypatch.setattr(m.asyncio,'create_subprocess_exec',spawn)
    with pytest.raises(HTTPException) as err:asyncio.run(m.extract(m.ExtractInput(text='商品',target=TARGET,model='ollama/qwen2.5:3b',baseUrl='http://127.0.0.1:11434')))
    assert err.value.status_code==502

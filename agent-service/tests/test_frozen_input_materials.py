"""Prepared v2 protocol integration. Scripted checker only; no provider quality score."""
import asyncio,copy,hashlib,json
import pytest
from neo_agent.frozen_evaluation import knowledge_fixture
from neo_agent.knowledge_monitor import KnowledgeJob,KnowledgeRuntime,validate_extraction


def material_item():
    text='合成记录：企业地区与登记职工人数尚未提供；库存阈值20件仅记录在candidate笔记，确认操作者为空。'
    version=hashlib.sha256(text.encode()).hexdigest()
    document={'id':'material-document','sourceId':'material-source','sourceVersion':2,'originalId':'synthetic-original','contentHash':version,'publishedAt':'2026-10-01','retrievedAt':'2026-10-08T01:00:00.000Z','paragraphs':[{'index':0,'text':text,'hash':version}],'coverage':{'kind':'current_observation'}}
    return {'id':'knowledge-scope_unknown','context':'企业地区与注册规模未知，补贴有地区规模要求。','businessId':'eval-ecommerce-b','inputVersion':'frozen-input-materials-v2','documentDispositionVersion':'document-disposition-v1','knowledgeScope':{'entities':['SKU-S2'],'channels':['tmall'],'asOf':'2026-09-30'},'knowledgeConfiguration':{'version':2,'region':None,'registeredEmployees':None,'objectives':[],'constraints':[]},'nativeDocument':{'materialHash':'materials-hash','document':document,'sources':[{'id':'source-1','version':1,'url':'https://example.com/source-1','contentHash':version,'publishedAt':'2026-10-01','retrievedAt':'2026-10-08T01:00:00.000Z'}],'sourceRelations':[],'paragraphLocators':[{'paragraphIndex':0,'sourceId':'source-1','sourceVersion':1,'sourceContentHash':version,'sourceParagraphIndex':0}],'contextRecords':{'candidates':[{'id':'candidate-threshold','state':'candidate','thresholdUnits':20,'confirmedBy':None}]}}}


def test_v2_knowledge_request_freezes_new_protocol_and_empty_claims_still_check_reason():
    item=material_item();original=copy.deepcopy(item);job,_=knowledge_fixture(item)
    serialized=KnowledgeJob.model_validate(job).model_dump();assert serialized==job and item==original
    assert job['documentDispositionVersion']=='document-disposition-v1'
    assert job['configuration']['region'] is None and job['configuration']['registeredEmployees'] is None
    assert not job['configuration']['constraints'] and job['scope']['contextRecords']['candidates'][0]['state']=='candidate'
    calls=[]
    class Checker:
        async def call(self,messages,tools=None):
            assert messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK')
            payload=json.loads(messages[1]['content']);calls.append(payload)
            assert payload['expectedCount']==1 and payload['evidenceCoverage']['omittedParagraphs']==0
            return {'content':json.dumps({'claims':[{'i':0,'s':'I','r':[],'c':[],'g':['脚本只测协议，未评模型语义']}]})},{}
    value={'claims':[],'documentDisposition':{'classification':'ignore','reason':'企业地区和规模记录为空。','paragraphIndices':[0],'gaps':[]}}
    result=asyncio.run(KnowledgeRuntime(None,Checker()).verify({'job':job,'extracted':validate_extraction(value,job)}))['result']
    assert len(calls)==1 and result['claims']==[]
    assert result['documentDisposition']['classification']=='research'
    assert result['documentDisposition']['supportStatus']=='insufficient'
    assert result['documentDisposition']['documentVersion']==job['document']['version']


def test_v2_requires_protocol_and_legacy_jobs_keep_original_unmarked_shape():
    item=material_item();del item['documentDispositionVersion']
    with pytest.raises(ValueError,match='explicit document disposition'):knowledge_fixture(item)
    del item['inputVersion'];legacy,_=knowledge_fixture(item)
    assert 'documentDispositionVersion' not in legacy
    assert 'sourceProvenance' not in legacy['scope'] and legacy['id']=='frozen-knowledge-scope_unknown'

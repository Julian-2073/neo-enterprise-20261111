import asyncio,json
import pytest
from neo_agent.frozen_provider_evaluation import evaluate
from neo_agent.frozen_evaluation import OfflineKnowledgeModel,knowledge_fixture
from neo_agent.execution import SingleAttemptModel

@pytest.mark.parametrize('usage_unknown,cap',[(False,1),(False,10),(True,10)])
def test_aggregate_provider_admission_preserves_journal_and_stops_on_unknown(tmp_path,monkeypatch,usage_unknown,cap):
    calls=[]
    async def call(self,messages,tools=None):
        calls.append(messages)
        value=knowledge_fixture({'id':'knowledge-wrong_region','context':'政策适用广东，企业浙江。','businessId':'eval-ecommerce-a','knowledgeScope':{'entities':['SKU-R1'],'asOf':'2026-09-30'}})[1]
        message,usage=await OfflineKnowledgeModel(value).call(messages,tools)
        return message,{} if usage_unknown else usage
    monkeypatch.setattr(SingleAttemptModel,'call',call)
    monkeypatch.setenv('LLM_MODEL','offline_admission_test_not_real_provider')
    cases=[{'id':'knowledge-wrong_region','category':'knowledge','context':'政策适用广东，企业浙江。','businessId':'eval-ecommerce-a','knowledgeScope':{'entities':['SKU-R1'],'asOf':'2026-09-30'},'expectationCoverage':'admission_protocol_only','unsupportedExpectations':['model_semantics']} for _ in range(1)]
    inputs={'frozenHash':'test-only','lineage':{'executionMode':'offline_admission_regression'},'cases':cases}
    result=asyncio.run(evaluate(inputs,tmp_path/'run',set(),1,cap,60000))
    assert result['totals']['invocations']==len(calls)
    assert len(calls)==(1 if usage_unknown or cap==1 else 2)
    assert result['meanScore'] is None and result['qualityGate']=='pending_model_assisted_and_human_review'
    assert result['totals']['reportedTokens']<=60000
    assert all(r['reservedTokens']<=60000 for r in result['totals']['reservations'])
    assert list((tmp_path/'run').glob('*/turn-0-call-journal.json'))
    if usage_unknown:assert result['totals']['unknown']==1 and result['totals']['reservedUnknownTokens']>0

def test_token_reservation_blocks_before_even_first_provider_http(tmp_path,monkeypatch):
    async def unexpected(*args,**kwargs):raise AssertionError('No HTTP allowed')
    monkeypatch.setattr(SingleAttemptModel,'call',unexpected)
    case={'id':'knowledge-wrong_region','category':'knowledge','context':'政策适用广东，企业浙江。','businessId':'eval-ecommerce-a','knowledgeScope':{'entities':['SKU-R1'],'asOf':'2026-09-30'},'expectationCoverage':'admission_protocol_only','unsupportedExpectations':[]}
    result=asyncio.run(evaluate({'frozenHash':'test','lineage':{},'cases':[case]},tmp_path/'run',set(),1,10,1))
    assert result['totals']['invocations']==0 and result['totals']['unknown']==0
    assert result['cases'][0]['status']=='failed_or_partial'

def test_actual_provider_identity_is_frozen_before_queue_without_mutating_prepared_fixture(tmp_path,monkeypatch):
    import copy
    from test_unified_runtime import job,CanonicalQueryModel
    from neo_agent.frozen_provider_evaluation import freeze_provider_job
    template=job('generation',question='只核对支付订单',mode='conversion')
    template['envelope']['operatingBasis']['modelIdentity']='prepared-placeholder'
    original=copy.deepcopy(template)
    admitted=freeze_provider_job(template,'configured-provider-version')
    assert template==original and admitted['envelope']['operatingBasis']['modelIdentity']=='configured-provider-version'
    requests=[]
    async def call(self,messages,tools=None):
        if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
            payload=json.loads(messages[1]['content']);requests.append(payload)
            assert self.name=='configured-provider-version'
            assert self.completion_tokens==6000
        return await CanonicalQueryModel().call(messages,tools)
    monkeypatch.setenv('LLM_MODEL','configured-provider-version');monkeypatch.setattr(SingleAttemptModel,'call',call)
    item={'id':'identity','category':'diagnosis','jobSequence':[template],'expectationCoverage':'actual_model_admission_protocol','unsupportedExpectations':[]}
    result=asyncio.run(evaluate({'frozenHash':'test','lineage':{'head':'prepared-old-head'},'cases':[item]},tmp_path/'run',set(),1,3,60000))
    assert result['cases'][0]['status']=='provider_completed_semantic_review_pending',result['cases']
    assert requests and template==original
    assert result['lineage']['head']=='prepared-old-head' and result['executionLineage']['head']!='prepared-old-head'
    saved=json.loads(next((tmp_path/'run').glob('*/turn-0-request.json')).read_text())
    assert saved['envelope']['operatingBasis']['modelIdentity']=='configured-provider-version'
    assert saved['budget']['maxTokens']==60000 and saved['budget']['maxModelCalls']==3
    assert saved['budget']['completionTokens']==6000
    receipt=json.loads(next((tmp_path/'run').glob('*/turn-0-admission-lineage.json')).read_text())
    assert receipt['preparedModelIdentity']=='prepared-placeholder' and receipt['admittedModelIdentity']=='configured-provider-version'
    assert receipt['preparedRequestHash']!=receipt['admittedRequestHash']

@pytest.mark.parametrize('case_id',['knowledge-effective_future','knowledge-repost','knowledge-conflict'])
def test_shared_offline_and_provider_knowledge_admission_preserves_prepared_identity_and_native_metadata(tmp_path,monkeypatch,case_id):
    import copy,hashlib
    from neo_agent.frozen_evaluation import run_frozen
    from neo_agent.engine import source_hash
    text='隔离验收资料；不是具体政策，企业适用性待核对。'
    document={'rawText':text,'paragraphs':[{'index':0,'text':text,'start':0,'end':len(text)}],'contentHash':hashlib.sha256(text.encode()).hexdigest(),'publishedAt':None,'retrievedAt':'2026-10-08T01:00:00Z','coverage':{'kind':'current_observation','actualStart':None,'actualEnd':None,'gaps':['current_only']}}
    item={'id':case_id,'category':'knowledge','context':text,'businessId':'eval-ecommerce-b','knowledgeScope':{'entities':['SKU-S2'],'channels':['tmall'],'asOf':'2026-09-30'},'nativeDocument':{'document':document,'assertions':[]},'expectationCoverage':'identity_transport_only','unsupportedExpectations':['real_policy_quality'],'notApplicableDimensions':[]}
    original=copy.deepcopy(item);j,_=knowledge_fixture(item);assert j['businessId']=='eval-ecommerce-b'
    for key,value in item['knowledgeScope'].items():assert j['scope'][key]==value
    assert j['scope']['documentProvenance']==document
    assert j['document']['retrievedAt']==document['retrievedAt'] and j['document']['publishedAt']==document['publishedAt']
    assert j['document']['paragraphs']==[{'index':r['index'],'text':r['text']} for r in document['paragraphs']]
    assert j['document']['version']==document['contentHash'] and item==original
    # Offline uses the same builder through its native-document lookup path.
    asyncio.run(run_frozen({'cases':[item],'knowledgeEvidence':[{'id':case_id,**item['nativeDocument']}],'frozenHash':'identity-test','lineage':{}},tmp_path/'offline'))
    offline=json.loads((tmp_path/'offline'/case_id/'request.json').read_text());assert offline==j
    calls=[]
    async def empty(self,messages,tools=None):
        calls.append(messages)
        return {'role':'assistant','content':'{"claims":[]}'},{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}
    monkeypatch.setattr(SingleAttemptModel,'call',empty)
    result=asyncio.run(evaluate({'cases':[item],'frozenHash':'identity-test','lineage':{}},tmp_path/'provider',set(),1,3,60000))
    provider=json.loads((tmp_path/'provider'/case_id/'turn-0-request.json').read_text());assert provider==offline and source_hash(provider)==source_hash(j)
    assert calls and item==original and result['meanScore'] is None


def test_shared_knowledge_builder_rejects_missing_prepared_enterprise_or_scope_before_dispatch():
    with pytest.raises(ValueError,match='enterprise identity'):knowledge_fixture({'id':'knowledge-test','context':'只用于结构验收'})
    with pytest.raises(ValueError,match='scope'):knowledge_fixture({'id':'knowledge-test','context':'只用于结构验收','businessId':'eval-ecommerce-b'})

@pytest.mark.parametrize('question,tokens,calls,completion',[
    ('只核对支付订单',12000,3,1200),('解释支付订单口径',12000,3,1200),('如果扩大库存推演方案',120000,12,3000)])
def test_explicit_benchmark_admission_uses_only_command_line_limits(question,tokens,calls,completion):
    from test_unified_runtime import job
    from neo_agent.frozen_provider_evaluation import admitted_provider_limits
    template=job('snapshot',question=question)
    limits=admitted_provider_limits(template,20,200000)
    assert (limits['maxTokens'],limits['maxModelCalls'],limits['completionTokens'])==(200000,20,6000)
    low=admitted_provider_limits(template,2,7000)
    assert (low['maxTokens'],low['maxModelCalls'],low['completionTokens'])==(7000,2,6000)
    template['budget']={'maxTokens':5000,'maxModelCalls':1,'completionTokens':700}
    lower=admitted_provider_limits(template,20,200000)
    assert (lower['maxTokens'],lower['maxModelCalls'],lower['completionTokens'])==(200000,20,6000)

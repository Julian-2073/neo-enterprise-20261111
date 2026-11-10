"""Long publication checks retain every statement and all counterevidence."""
import asyncio,json
import pytest
import neo_agent.claim_support as support
from neo_agent.execution import ExecutionError,SingleAttemptModel

def long_review():
    return {'finding':{'candidates':['请核对经营事项'+str(i) for i in range(116)]}}

def catalog():
    return {'metric:review':{'id':'metric:review','kind':'metric','exact':'{"value":116}'},
            'source:counter':{'id':'source:counter','kind':'paragraph','exact':'完整反证原文，不能在后续批次省略。'}}

def test_completed_business_read_reconstructs_exact_blocks_but_never_unread_pages():
    import copy
    from test_engine import fixture
    from neo_agent.business_queries import query_facts
    env=fixture();args={'section':'conversion','grain':'period'};result=query_facts(env,'conversion',args)
    read={'tool':'read_business','status':'completed','arguments':args,'queryEvidence':result['queryEvidence']}
    state={'job':{'envelope':env},'runtimePlan':{'taskType':'REVIEW'},'diagnostics':{'customerJourney':{'period':{'counts':{'A4':46}},'limitation':'演示资料，非新客'}}}
    draft={'toolReads':[read]};before=copy.deepcopy((state,draft))
    refs=support.evidence_catalog(state,draft)
    assert json.loads(refs['diagnostic:customerJourney']['exact'])==state['diagnostics']['customerJourney']
    assert next(json.loads(r['exact']) for k,r in refs.items() if k.endswith(':totals'))==result['totals']
    assert next(json.loads(r['exact']) for k,r in refs.items() if k.endswith(':productChannelAggregates'))==result['productChannelAggregates']
    assert next(json.loads(r['exact']) for k,r in refs.items() if k.endswith(':weeklyTotals'))==query_facts(env,'conversion',{**args,'grain':'week','comparePrevious':False})['weeklyTotals']
    assert (state,draft)==before
    failed={'toolReads':[{**read,'status':'failed'}]}
    assert not any(k.startswith('read:') for k in support.evidence_catalog(state,failed))
    mismatched=copy.deepcopy(draft);mismatched['toolReads'][0]['queryEvidence']['matchingFactIdsHash']='other'
    with pytest.raises(ExecutionError,match='指纹不一致'):support.evidence_catalog(state,mismatched)

def test_saved_market_paragraphs_require_completed_page_and_recorded_source_id():
    from test_engine import fixture
    env=fixture();sources=[{'id':'source-'+str(i),'verificationStatus':'source_read','content':'已保存原文段落'+str(i),'publishedAt':'2026-09-24'} for i in range(12)]
    env['decisionContext']={'marketEvidence':sources}
    state={'job':{'envelope':env},'runtimePlan':{'taskType':'REVIEW'}}
    read={'tool':'read_decisions','status':'completed','arguments':{'section':'market','cursor':10},'evidenceIds':[s['id'] for s in sources]}
    refs=support.evidence_catalog(state,{'toolReads':[read]})
    paragraphs=[r for r in refs.values() if r['kind']=='paragraph']
    assert {r['sourceId'] for r in paragraphs}=={'source-10','source-11'}
    assert {r['exact'] for r in paragraphs}=={'已保存原文段落10','已保存原文段落11'}
    assert not any(r['kind']=='paragraph' for r in support.evidence_catalog(state,{'toolReads':[{**read,'status':'failed'}]}).values())

def test_wire_reuses_exact_paragraphs_without_merging_source_time_or_reference_identity():
    refs={id:{'id':id,'kind':'paragraph','exact':'同一完整段落','sourceId':id,'publishedAt':day,'applicabilityVerified':False} for id,day in [('a','2026-09-01'),('b','2026-10-01')]}
    wire,scopes=support.evidence_wire(refs)
    assert wire[0]['exact']=='同一完整段落' and wire[1]['sameExactAs']==0
    assert scopes[wire[0]['scopeIndex']]['publishedAt']=='2026-09-01'
    assert scopes[wire[1]['scopeIndex']]['publishedAt']=='2026-10-01'
    decoded,resolved=support.decode_compact_claims({'claims':[{'i':0,'s':'S','r':[1],'c':[0],'g':[]}]},refs,{},1)
    assert decoded['claims'][0]['references']==[{'id':'b','quote':'同一完整段落'}]
    assert decoded['claims'][0]['counterevidence']==[refs['a']]

def test_prefixed_home_verification_is_pending_but_embedded_facts_remain_assertions():
    text='先核对退款的商品渠道，再核实到货是否已上架'
    assert support.statement_type(text)=='verification_request'
    assert support.statement_type('按商品核对退款原因','draft.finding.homeDecision.jointReview.confirmations.0.check')=='verification_request'
    for factual in ('先核对最近四周退款21件的商品渠道','先核实库存不足导致销量下降','先核对已经完成的上架'):
        assert support.statement_type(factual)=='assertion'
    claim={'index':0,'status':'insufficient','references':[],'applicability':'frozen','counterevidence':[],'gaps':['待核实']}
    item={'statement':text,'path':'draft.finding.conclusion','statementType':support.statement_type(text)}
    result=support.validate_claims({'claims':[claim]},[item],catalog(),{})
    assert result[0]['definitive'] is False and result[0]['status']=='insufficient'
    with pytest.raises(ExecutionError,match='矛盾'):
        support.validate_claims({'claims':[{**claim,'status':'contradicted'}]},[item],catalog(),{})

@pytest.mark.parametrize('repair_second',[False,True])
def test_long_review_checks_all_116_statements_without_repeating_accepted_batches(monkeypatch,repair_second):
    monkeypatch.setattr(support,'evidence_catalog',lambda *args:catalog())
    payloads=[];did_repair=False
    class Checker:
        async def call(self,messages,tools=None):
            nonlocal did_repair
            p=json.loads(messages[1]['content']);payloads.append(p)
            assert len(p['statements'])<=24
            assert p['evidence'][1]['exact']==catalog()['source:counter']['exact']
            assert p['scope']=={'businessId':'frozen-business'}
            rows=[{'i':i,'s':'S','r':[0],'c':[],'g':[]} for i in range(len(p['statements']))]
            if repair_second and len(payloads)==2 and not did_repair:
                rows.pop();did_repair=True
            return {'content':json.dumps({'claims':list(reversed(rows))})},{'total_tokens':100}
    claims,usage=asyncio.run(support.check_claim_support({'scope':{'businessId':'frozen-business'}},long_review(),Checker()))
    assert [c['statement'] for c in claims]==long_review()['finding']['candidates']
    assert len({c['id'] for c in claims})==116
    assert len(payloads)==5+int(repair_second)
    assert len(usage)==len(payloads)
    assert all(p['evidence']==payloads[0]['evidence'] for p in payloads)
    assert all(p['requiredIndices']==list(range(p['expectedCount'])) for p in payloads)
    if repair_second:
        assert payloads[2]['statements']==payloads[1]['statements'][-1:]
        assert payloads[2]['expectedCount']==1 and payloads[2]['requiredIndices']==[0]

def test_later_batch_conflict_still_rejects_whole_publication(monkeypatch):
    monkeypatch.setattr(support,'evidence_catalog',lambda *args:catalog())
    calls=[]
    class Checker:
        async def call(self,messages,tools=None):
            p=json.loads(messages[1]['content']);calls.append(p)
            rows=[{'i':i,'s':'S','r':[0],'c':[],'g':[]} for i in range(len(p['statements']))]
            if len(calls)==3:rows[-1]={'i':len(rows)-1,'s':'C','r':[],'c':[1],'g':['与完整原文矛盾']}
            return {'content':json.dumps({'claims':rows})},{}
    with pytest.raises(ExecutionError,match='矛盾'):
        asyncio.run(support.check_claim_support({'scope':{}},long_review(),Checker()))
    assert len(calls)==3 and calls[-1]['evidence'][1]['exact']==catalog()['source:counter']['exact']

def test_model_total_deadline_cancels_one_attempt_even_if_transport_is_still_waiting(monkeypatch):
    import httpx
    from neo_agent import execution
    monkeypatch.setenv('LLM_API_KEY','offline-fake-not-a-credential')
    monkeypatch.setenv('LLM_MODEL','OFFLINE_TEST_ADAPTER')
    monkeypatch.setenv('LLM_BASE_URL','https://offline.invalid/v1')
    requests=[];cancelled=[]
    async def response(request):
        requests.append(request)
        try:await asyncio.Event().wait()
        except asyncio.CancelledError:cancelled.append(True);raise
    original=httpx.AsyncClient
    monkeypatch.setattr(execution.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(response),**kwargs))
    async def run():
        with pytest.raises(ExecutionError,match='计费状态未知') as error:
            await SingleAttemptModel(response_timeout_seconds=.02).call([{'role':'user','content':'q'}])
        assert error.value.code=='MODEL_CALL_UNCERTAIN'
    asyncio.run(run())
    assert len(requests)==1 and cancelled==[True]

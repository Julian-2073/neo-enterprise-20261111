import base64,gzip,json
import pytest
from neo_agent.ontology import expand_ontology,query_objects
from test_ontology import object_env


def pack(value):
    raw=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
    return {'codec':'gzip-base64','rawBytes':len(raw),'payload':base64.b64encode(gzip.compress(raw)).decode()}


def test_full_envelope_is_lossless_and_legacy_inputs_still_work():
    e=object_env();e['facts'][0]['availableAt']='2026-09-29T00:00:00Z'
    compact={'ontologyRef':e['ontologyRef'],'envelopePacked':pack(e)}
    assert expand_ontology(compact)==e
    assert expand_ontology(e)==e
    legacy={**e,'ontologyPacked':pack(e['ontology'])};del legacy['ontology']
    # Older packed inputs do not have the optional rawBytes header.
    del legacy['ontologyPacked']['rawBytes']
    assert expand_ontology(legacy)['ontology']==e['ontology']
    double={**legacy,'envelopePacked':pack(legacy)}
    double={'ontologyRef':e['ontologyRef'],'envelopePacked':double['envelopePacked']}
    assert expand_ontology(double)['facts']==e['facts']
    assert query_objects(compact,{'typeId':'sku'})['items'][0]['id']=='s'


def test_queue_context_overlay_cannot_replace_frozen_inputs():
    e=object_env();compact={'ontologyRef':e['ontologyRef'],'envelopePacked':pack(e),'decisionContext':{'meta':{'inputHash':'new'}},'facts':[],'snapshot':{'id':'wrong'}}
    expanded=expand_ontology(compact)
    assert expanded['facts']==e['facts'] and expanded['snapshot']==e['snapshot']
    assert expanded['decisionContext']==compact['decisionContext']
    assert e.get('decisionContext')!=compact['decisionContext']


def test_corruption_ref_mismatch_nested_input_and_decode_budget_are_rejected():
    e=object_env();packed=pack(e)
    invalid=[{'ontologyRef':e['ontologyRef'],'envelopePacked':['invalid']},
             {'ontologyRef':{'buildId':'other'},'envelopePacked':packed},
             {'ontologyRef':e['ontologyRef'],'envelopePacked':{**packed,'rawBytes':1}},
             {'ontologyRef':e['ontologyRef'],'envelopePacked':{**packed,'payload':'broken'}},
             {'ontologyRef':e['ontologyRef'],'envelopePacked':pack({**e,'envelopePacked':packed})},
             {'ontologyRef':e['ontologyRef'],'envelopePacked':pack({**e,'oversize':'x'*(16*1024*1024)})}]
    for value in invalid:
        with pytest.raises(ValueError):expand_ontology(value)


def test_compact_conversation_job_validates_inner_scope_and_preserves_queue_encoding():
    from neo_agent.contracts import Job
    e=object_env();s=e['snapshot'];s.update(businessId='test-a',dataNature='demo')
    e['facts']=[{**e['facts'][0],'id':str(i),'extra':'原始资料'*150} for i in range(3259)]
    compact={'ontologyRef':e['ontologyRef'],'envelopePacked':pack(e)}
    payload=dict(id='compact-run',businessId='test-a',dataNature='demo',snapshotId=s['id'],sessionId='compact-session',mode='conversion',question='核对保存资料',envelope=compact)
    j=Job(**payload)
    assert j.envelope==compact
    assert len(expand_ontology(j.envelope)['facts'])==3259
    assert expand_ontology(j.envelope)['snapshot']==s
    with pytest.raises(ValueError):Job(**{**payload,'businessId':'another-business'})
    forged={**compact,'snapshot':{**s,'businessId':'another-business'}}
    # Outer headers cannot hide contradictory frozen scope.
    with pytest.raises(ValueError):Job(**{**payload,'businessId':'another-business','envelope':forged})


def test_regular_compact_conversation_without_ontology_keeps_facts_and_scope():
    from neo_agent.contracts import Job
    e={'snapshot':{'id':'plain-snap','businessId':'test-a','dataNature':'demo'},'facts':[{'id':'fact-1','fact':{'quantity':3}}],'decisionContext':{'decisions':[]}}
    compact={'envelopePacked':pack(e)}
    j=Job(id='plain-run',businessId='test-a',dataNature='demo',snapshotId='plain-snap',sessionId='plain-session',mode='supply',question='核对库存',envelope=compact)
    assert expand_ontology(j.envelope)==e

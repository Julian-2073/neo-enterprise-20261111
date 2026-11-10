import asyncio,copy,json
from types import SimpleNamespace
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
import neo_agent.claim_support as support
from neo_agent.completed_recovery import prepare_completed_recovery
from neo_agent.execution import ExecutionError,JournaledModel
from neo_agent.engine import source_hash
from neo_agent.runtime import NeoRuntime,frozen_scope
from neo_agent.job_queue import JobQueue,QueueConflict
from test_queue_reliability import make_job


def test_completed_claims_reused_only_with_same_text_type_scope_and_all_evidence(monkeypatch):
    refs={'record':{'id':'record','kind':'metric','exact':'{"value":7}'}}
    monkeypatch.setattr(support,'evidence_catalog',lambda *a:refs)
    class Checker:
        calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            return {'content':json.dumps({'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[]}]})},{}
    model=Checker();state={'scope':{'businessId':'b'}};draft={'finding':{'conclusion':'退款7件'}}
    claims,_=asyncio.run(support.check_claim_support(state,draft,model))
    item=support.statements(draft)[0];cache={'fingerprint':source_hash({'catalog':refs,'scope':state['scope']}),'entries':{}}
    support.cache_claim(cache,item,claims[0]);state['claimVerificationCache']=cache
    again,usage=asyncio.run(support.check_claim_support(state,draft,model))
    assert again==claims and usage==[] and model.calls==1
    refs['record']['exact']='{"value":8}'
    asyncio.run(support.check_claim_support(state,draft,model));assert model.calls==2
    asyncio.run(support.check_claim_support(state,{'finding':{'conclusion':'退款8件'}},model));assert model.calls==3


def test_cached_verdict_cannot_bypass_new_local_causal_fence(monkeypatch):
    refs={'record':{'id':'record','kind':'metric','exact':'{"value":7}'}}
    item={'statement':'退款导致负毛利','statementType':'assertion','path':'draft.finding.conclusion','paths':['draft.finding.conclusion']}
    claim={'status':'supported','supportingReferences':[refs['record']],'applicability':'scope','counterevidence':[],'gaps':[]}
    cache={'entries':{}};support.cache_claim(cache,item,claim)
    assert support.cached_claim(item,cache,refs,{}) is None


def test_fresh_recovery_inherits_internal_checkpoint_but_never_unknown_call(tmp_path):
    q=JobQueue(tmp_path/'jobs.sqlite');q.initialize();parent=make_job('parent',purpose='home',mode='orchestrator')
    q.submit(parent,source_hash(parent))
    messages=[{'role':'user','content':'lost request'}];key=source_hash({'model':'offline','messages':messages,'tools':None})
    with q.db() as c:
        c.execute("UPDATE jobs SET status='failed' WHERE id='parent'")
        c.execute("INSERT INTO model_calls(job_id,call_key,state,model) VALUES('parent',?,'uncertain','offline')",(key,))
    child={**parent,'id':'child','sessionId':'new-session','recoveryFrom':'parent'}
    async def work():
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            state={'job':parent,'scope':frozen_scope(parent),'draft':{'finding':{'conclusion':'仅为内部草稿'}},'claimVerificationCache':{'entries':{}}}
            await NeoRuntime(saver,None).graph.aupdate_state({'configurable':{'thread_id':'parent'}},state,as_node='synthesis')
        wrong=copy.deepcopy(child);wrong['envelope']['snapshot']['asOf']='2026-10-08'
        with pytest.raises(QueueConflict):await prepare_completed_recovery(q,wrong)
        await prepare_completed_recovery(q,child)
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            saved=await NeoRuntime(saver,None).graph.aget_state({'configurable':{'thread_id':'child'}})
            assert saved.next==('validation',) and saved.values['job']==child and not saved.values.get('assessment')
    asyncio.run(work());q.submit(child,source_hash(child))
    model=JournaledModel(q,'child',SimpleNamespace(name='offline'))
    assert model.blocks_call(messages) and not model.blocks_call([{'role':'user','content':'different independent request'}])
    with q.db() as c:
        assert c.execute("SELECT count(*) FROM model_calls WHERE job_id='child'").fetchone()[0]==0
        assert c.execute("SELECT state FROM model_calls WHERE job_id='parent'").fetchone()[0]=='uncertain'

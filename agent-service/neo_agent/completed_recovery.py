"""Explicit fresh recovery keeps known checkpoints and never copies unknown calls."""
import json
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from .engine import source_hash
from .job_queue import QueueConflict
from .runtime import NeoRuntime,frozen_scope

async def prepare_completed_recovery(queue,job):
    parent_id=job['recoveryFrom']
    with queue.db() as c:
        existing=c.execute('SELECT hash FROM jobs WHERE id=?',(job['id'],)).fetchone()
        if existing:
            if existing['hash']!=source_hash(job):raise QueueConflict('新恢复任务ID已有不同输入')
            return
        parent=c.execute('SELECT payload,status,lease_owner FROM jobs WHERE id=?',(parent_id,)).fetchone()
    if not parent or parent['status']!='failed' or parent['lease_owner'] is not None:raise QueueConflict('原任务须已失败且没有运行中的租约')
    original=json.loads(parent['payload'])
    def identity(value):return {k:v for k,v in value.items() if k not in ('id','sessionId','recoveryFrom')}
    if job.get('purpose')!='home' or source_hash(identity(job))!=source_hash(identity(original)):
        raise QueueConflict('恢复必须使用原首页任务的完整冻结输入和运行条件')
    async with AsyncSqliteSaver.from_conn_string(queue.path+'.checkpoints') as saver:
        checkpoint=await saver.aget_tuple({'configurable':{'thread_id':parent_id}})
        values=checkpoint.checkpoint.get('channel_values',{}) if checkpoint else {}
        if source_hash(values.get('job'))!=source_hash(original) or values.get('scope')!=frozen_scope(job) or not values.get('draft'):
            raise QueueConflict('原任务没有可核验的同范围修正检查点')
        if values.get('assessment') or values.get('result'):raise QueueConflict('已发布结果不能作为失败任务恢复')
        state={k:v for k,v in values.items() if k not in ('claims','assessment','result')};state.update(job=job,claims=[])
        # A compiled graph writes the real synthesis-to-validation edge before
        # queue submission, so a worker cannot race and start from scratch.
        graph=NeoRuntime(saver,model=None).graph
        await graph.aupdate_state({'configurable':{'thread_id':job['id']}},state,as_node='synthesis')
    with queue.db(immediate=True) as c:
        queue.event(c,job['id'],'completed_checkpoint_inherited',{'parentId':parent_id,'scopeHash':source_hash(state['scope']),'semanticStatus':'unverified','copiedUnknownCalls':0,'cachedClaims':len(state.get('claimVerificationCache',{}).get('entries',{}))})

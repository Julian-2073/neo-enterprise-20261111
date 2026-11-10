"""SQLite single-worker queue with fenced claims and durable per-run audit.

The TS gateway still owns pending_dispatch. No automatic model retries here.
"""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
import json
import sqlite3
import uuid
from .engine import source_hash
from .task_plan import task_limits,unlimited_limits

DEFAULT_LIMITS = {'maxAttempts':3, 'maxModelCalls':None, 'maxTokens':None,
                  'maxToolCalls':None, 'maxMarketSearches':None,
                  'completionTokens':None, 'timeoutSeconds':1800}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def event_projection(row, job_id):
    """Keep the immutable audit body locally; send a bounded status receipt.

    Knowledge documents can exceed the gateway's D1 row limit when copied
    into status events. Model input and checkpoint results remain complete.
    """
    data=json.loads(row['payload'])
    if 'result' in data and len(json.dumps(data['result'],ensure_ascii=False).encode())>16000:
        result=data.pop('result')
        data['resultRef']={'jobId':job_id,'eventSequence':row['seq'],
                           'sha256':source_hash(result),'storage':'run_events.payload.result',
                           'bytes':len(json.dumps(result,ensure_ascii=False).encode())}
    return {'kind':row['kind'],'at':row['created_at'],'data':data}


def elapsed(a, b):
    if not a or not b:
        return 0.0
    return max(0.0, (datetime.fromisoformat(b)-datetime.fromisoformat(a)).total_seconds())


def usage_tokens(usage):
    if type(usage.get('total_tokens')) is int and usage['total_tokens'] >= 0:
        return usage['total_tokens']
    if all(type(usage.get(k)) is int and usage[k] >= 0 for k in ('prompt_tokens','completion_tokens')):
        return usage['prompt_tokens'] + usage['completion_tokens']
    return None


class QueueConflict(ValueError):
    pass


class JobQueue:
    def __init__(self, path):
        self.path = str(Path(path).resolve())

    @contextmanager
    def db(self, immediate=False):
        c = sqlite3.connect(self.path, timeout=5)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA busy_timeout=5000')
        try:
            if immediate:
                c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,hash TEXT,payload TEXT,status TEXT,steps TEXT,result TEXT,error TEXT,created_at TEXT,updated_at TEXT)')
            columns = {r[1] for r in c.execute('PRAGMA table_info(jobs)')}
            additions = {'priority':'INTEGER NOT NULL DEFAULT 10', 'queued_at':'TEXT',
                'started_at':'TEXT', 'finished_at':'TEXT', 'attempt_count':'INTEGER NOT NULL DEFAULT 0',
                'first_started_at':'TEXT', 'last_started_at':'TEXT',
                'lease_owner':'TEXT', 'lease_expires_at':'TEXT', 'wait_seconds':'REAL NOT NULL DEFAULT 0',
                'run_seconds':'REAL NOT NULL DEFAULT 0', 'limits_json':'TEXT',
                'deferred_until':'TEXT', 'execution_lane':'TEXT', 'error_code':'TEXT', 'retryable':'INTEGER NOT NULL DEFAULT 0'}
            for name, spec in additions.items():
                if name not in columns:
                    c.execute(f'ALTER TABLE jobs ADD COLUMN {name} {spec}')
            c.execute("UPDATE jobs SET priority=CASE WHEN json_extract(payload,'$.purpose') IN ('patrol','knowledge') OR json_extract(payload,'$.envelope.monitorReview') IS NOT NULL THEN 0 ELSE 10 END,queued_at=COALESCE(queued_at,created_at),limits_json=COALESCE(limits_json,?)", (json.dumps(DEFAULT_LIMITS),))
            c.execute('CREATE INDEX IF NOT EXISTS jobs_dispatch ON jobs(status,priority DESC,queued_at,id)')
            c.execute('CREATE TABLE IF NOT EXISTS patrol_watches(scope TEXT PRIMARY KEY,snapshot_id TEXT,payload TEXT,last_day TEXT,updated_at TEXT)')
            c.execute('CREATE TABLE IF NOT EXISTS run_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,kind TEXT,payload TEXT,created_at TEXT)')
            c.execute('CREATE INDEX IF NOT EXISTS run_events_job ON run_events(job_id,seq)')
            c.execute('CREATE TABLE IF NOT EXISTS model_calls(job_id TEXT,call_key TEXT,state TEXT,model TEXT,response TEXT,usage TEXT,error TEXT,reserved_tokens INTEGER,started_at TEXT,finished_at TEXT,PRIMARY KEY(job_id,call_key))')
            c.execute('CREATE TABLE IF NOT EXISTS tool_operations(job_id TEXT,operation_key TEXT,tool TEXT,state TEXT,payload TEXT,created_at TEXT,updated_at TEXT,PRIMARY KEY(job_id,operation_key))')
            c.execute("UPDATE jobs SET error_code='LEGACY_EXECUTION_UNCERTAIN',retryable=0 WHERE status IN ('failed','cancelled') AND attempt_count=0 AND (result IS NOT NULL OR steps!='[]') AND NOT EXISTS(SELECT 1 FROM model_calls m WHERE m.job_id=jobs.id)")
            c.execute("UPDATE jobs SET status='failed',error_code='LEGACY_EXECUTION_UNCERTAIN',error='升级前执行过的排队任务没有逐调用记录；核对后另建任务',retryable=0 WHERE status='queued' AND attempt_count=0 AND steps!='[]' AND NOT EXISTS(SELECT 1 FROM model_calls m WHERE m.job_id=jobs.id)")

    @staticmethod
    def event(c, ident, kind, data):
        c.execute('INSERT INTO run_events(job_id,kind,payload,created_at) VALUES(?,?,?,?)', (ident,kind,json.dumps(data,ensure_ascii=False),stamp()))

    def submit(self, job, digest, register=None):
        ident = job['id']
        with self.db(immediate=True) as c:
            prior = c.execute('SELECT hash FROM jobs WHERE id=?', (ident,)).fetchone()
            if prior:
                if prior['hash'] != digest:
                    raise QueueConflict('运行 ID 对应的任务内容不同；新条件须创建新任务与输入版本')
                return False
            limits = task_limits(job,DEFAULT_LIMITS)
            created = stamp()
            priority = 0 if job.get('purpose') in ('patrol','knowledge') or job.get('envelope',{}).get('monitorReview') else 10
            c.execute("INSERT INTO jobs(id,hash,payload,status,steps,created_at,updated_at,queued_at,priority,limits_json) VALUES(?,?,?,'queued','[]',?,?,?,?,?)",
                (ident,digest,json.dumps(job,ensure_ascii=False),created,created,created,priority,json.dumps(limits)))
            self.event(c,ident,'queued',{'priority':priority,'inputHash':digest})
            if register:
                register(c)
            return True

    def recover(self, moment=None):
        moment = moment or stamp()
        with self.db(immediate=True) as c:
            c.execute("UPDATE jobs SET status='queued',deferred_until=NULL,error=NULL,error_code=NULL,queued_at=? WHERE status='deferred' AND deferred_until<=?",(moment,moment))
            rows = c.execute("SELECT * FROM jobs WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)", (moment,)).fetchall()
            for r in rows:
                unknown = c.execute("SELECT 1 FROM model_calls WHERE job_id=? AND state IN ('started','uncertain') LIMIT 1", (r['id'],)).fetchone()
                legacy_unknown = r['attempt_count']==0 and r['lease_owner'] is None
                exhausted = r['attempt_count'] >= json.loads(r['limits_json'])['maxAttempts']
                state = 'failed' if unknown or legacy_unknown or exhausted else 'queued'
                code = 'LEGACY_EXECUTION_UNCERTAIN' if legacy_unknown else 'MODEL_CALL_UNCERTAIN' if unknown else 'ATTEMPTS_EXHAUSTED' if exhausted else 'WORKER_INTERRUPTED'
                error = '上次模型调用是否完成或扣费未知，已阻止自动重发；核对后另建任务' if unknown else '已达到领取尝试上限' if exhausted else 'worker中断，等待从已保存检查点恢复'
                if legacy_unknown:error='升级前运行没有逐调用记录，不能确认在途请求是否计费；保留检查点，核对后另建任务'
                c.execute('UPDATE jobs SET status=?,error=?,error_code=?,retryable=?,queued_at=?,finished_at=?,run_seconds=run_seconds+?,started_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?',
                    (state,error,code,int(not unknown and not legacy_unknown and not exhausted),moment,moment if state=='failed' else None,elapsed(r['started_at'],moment),moment,r['id']))
                c.execute("UPDATE model_calls SET state='uncertain',error=?,finished_at=? WHERE job_id=? AND state='started'", (error,moment,r['id']))
                self.event(c,r['id'],'recovered',{'status':state,'errorCode':code})
            # A process may die after a cancellation request but before it
            # releases its execution lease. Make such jobs inspectable/resumable
            # only after fencing expires and accounting for ambiguous calls.
            for r in c.execute("SELECT * FROM jobs WHERE status='cancelled' AND lease_owner IS NOT NULL AND lease_expires_at<=?",(moment,)).fetchall():
                c.execute("UPDATE model_calls SET state='uncertain',error='取消后worker中断，计费待核对',finished_at=? WHERE job_id=? AND state='started'",(moment,r['id']))
                c.execute('UPDATE jobs SET lease_owner=NULL,lease_expires_at=NULL,run_seconds=run_seconds+?,started_at=NULL,updated_at=? WHERE id=?',(elapsed(r['started_at'],moment),moment,r['id']))
                self.event(c,r['id'],'cancel_settled_after_expiry',{})
            return len(rows)

    def claim(self, owner, lease_seconds=15, lane=None):
        if lane not in (None,'interactive','background'):raise ValueError('Unknown execution lane')
        now = stamp()
        until = (datetime.fromisoformat(now)+timedelta(seconds=lease_seconds)).isoformat()
        with self.db(immediate=True) as c:
            # The default retains the legacy global fence. Opt-in lanes reserve
            # one interactive slot and one background slot across all processes.
            fence=' AND (execution_lane IS NULL OR execution_lane=?)' if lane else ''
            if c.execute('SELECT 1 FROM jobs WHERE lease_owner IS NOT NULL AND lease_expires_at>?'+fence+' LIMIT 1', (now,lane) if lane else (now,)).fetchone():
                return None
            background="COALESCE(json_extract(payload,'$.purpose'),'analysis') IN ('operating','patrol','review','home','briefing','weekly','knowledge') AND json_extract(payload,'$.envelope.operatingBasis.interaction') IS NULL"
            selector=(' AND ('+background+')' if lane=='background' else ' AND NOT ('+background+')') if lane else ''
            r = c.execute("SELECT j.* FROM jobs j WHERE status='queued'"+selector+" ORDER BY priority DESC,COALESCE((SELECT MAX(p.last_started_at) FROM jobs p WHERE json_extract(p.payload,'$.businessId')=json_extract(j.payload,'$.businessId')),''),COALESCE(queued_at,created_at),id LIMIT 1").fetchone()
            if not r:
                return None
            limits = json.loads(r['limits_json'] or json.dumps(DEFAULT_LIMITS))
            if r['attempt_count'] >= limits['maxAttempts']:
                c.execute("UPDATE jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',error='已达到领取尝试上限',finished_at=?,updated_at=? WHERE id=?", (now,now,r['id']))
                return None
            c.execute("UPDATE jobs SET status='running',attempt_count=attempt_count+1,started_at=?,first_started_at=COALESCE(first_started_at,?),last_started_at=?,finished_at=NULL,wait_seconds=wait_seconds+?,lease_owner=?,lease_expires_at=?,error=NULL,error_code=NULL,retryable=0,updated_at=? WHERE id=? AND status='queued'",
                (now,now,now,elapsed(r['queued_at'] or r['created_at'],now),owner,until,now,r['id']))
            c.execute('UPDATE jobs SET execution_lane=? WHERE id=?',(lane,r['id']))
            self.event(c,r['id'],'claimed',{'owner':owner,'lane':lane,'attempt':r['attempt_count']+1})
            return dict(c.execute('SELECT * FROM jobs WHERE id=?', (r['id'],)).fetchone())

    def heartbeat(self, ident, owner, lease_seconds=15):
        now = stamp()
        until = (datetime.fromisoformat(now)+timedelta(seconds=lease_seconds)).isoformat()
        with self.db(immediate=True) as c:
            r = c.execute('SELECT status,lease_owner FROM jobs WHERE id=?', (ident,)).fetchone()
            if not r or r['lease_owner'] != owner:
                return False
            # Keep cancelled task fenced until the in-flight coroutine unwinds.
            c.execute('UPDATE jobs SET lease_expires_at=? WHERE id=? AND lease_owner=?', (until,ident,owner))
            return r['status'] == 'running'

    def progress(self, ident, message, owner=None):
        with self.db(immediate=True) as c:
            r = c.execute('SELECT status,steps,lease_owner FROM jobs WHERE id=?', (ident,)).fetchone()
            if not r or r['status'] != 'running' or owner and r['lease_owner'] != owner:
                return False
            steps = (json.loads(r['steps'])+[{'message':message,'at':stamp()}])[-60:]
            c.execute('UPDATE jobs SET steps=?,updated_at=? WHERE id=?', (json.dumps(steps,ensure_ascii=False),stamp(),ident))
            return True

    def finish(self, ident, owner, state, result=None, error=None, code=None, retryable=False):
        now = stamp()
        with self.db(immediate=True) as c:
            r = c.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone()
            if not r or r['lease_owner'] != owner:
                return False
            final = 'cancelled' if r['status'] == 'cancelled' else state
            c.execute('UPDATE jobs SET status=?,result=COALESCE(?,result),error=?,error_code=?,retryable=?,finished_at=?,run_seconds=run_seconds+?,started_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?',
                (final,json.dumps(result,ensure_ascii=False) if result is not None else None,error,code,int(retryable),now,elapsed(r['started_at'],now),now,ident,owner))
            if final=='deferred':
                tomorrow=(datetime.fromisoformat(now).astimezone(timezone(timedelta(hours=8))).date()+timedelta(days=1)).isoformat()+'T01:00:00+00:00'
                c.execute('UPDATE jobs SET deferred_until=?,attempt_count=MAX(0,attempt_count-1) WHERE id=?',(tomorrow,ident))
            self.event(c,ident,'finished',{'status':final,'errorCode':code})
            return True

    def cancel(self, ident):
        with self.db(immediate=True) as c:
            r = c.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone()
            if not r:
                raise KeyError(ident)
            if r['status'] in ('queued','running'):
                now = stamp()
                wait = elapsed(r['queued_at'],now) if r['status']=='queued' else 0
                c.execute("UPDATE jobs SET status='cancelled',finished_at=?,wait_seconds=wait_seconds+?,updated_at=? WHERE id=?", (now,wait,now,ident))
                self.event(c,ident,'cancel_requested',{})

    def resume(self, ident):
        with self.db(immediate=True) as c:
            r = c.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone()
            if not r:
                raise KeyError(ident)
            if r['status'] == 'queued':
                return False  # Lost response after a successful resume is safe.
            if r['status'] in ('running','completed') and c.execute("SELECT 1 FROM run_events WHERE job_id=? AND kind='resume_requested' LIMIT 1",(ident,)).fetchone():
                return False  # The resumed execution may already have advanced.
            if r['status'] not in ('failed','cancelled'):
                raise QueueConflict('仅可恢复失败或取消的任务；新条件须创建新任务')
            if r['lease_owner']:
                raise QueueConflict('取消正在收尾，请回读后恢复')
            if r['error_code']=='LEGACY_EXECUTION_UNCERTAIN':
                raise QueueConflict('升级前在途请求状态未知，禁止重发；核对后另建任务')
            if r['error_code'] in ('RUN_TIMEOUT','MODEL_VERSION_CHANGED','MARKET_REPLAY_BLOCKED'):
                raise QueueConflict('本任务运行或版本边界已触发；不可修改旧任务，请核对后另建任务')
            if c.execute("SELECT 1 FROM model_calls WHERE job_id=? AND state IN ('started','uncertain')", (ident,)).fetchone():
                raise QueueConflict('上次模型调用计费状态未知，禁止重发；核对服务记录后另建任务')
            if r['attempt_count'] >= json.loads(r['limits_json'])['maxAttempts']:
                raise QueueConflict('已达到领取尝试上限；须核对失败原因后另建任务')
            now = stamp()
            c.execute("UPDATE jobs SET status='queued',queued_at=?,finished_at=NULL,error=NULL,error_code=NULL,retryable=0,updated_at=? WHERE id=?", (now,now,ident))
            self.event(c,ident,'resume_requested',{})
            return True

    def observe(self, ident):
        now = stamp()
        with self.db() as c:
            r = c.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone()
            if not r:
                raise KeyError(ident)
            result = json.loads(r['result']) if r['result'] else None
            models = c.execute('SELECT * FROM model_calls WHERE job_id=? ORDER BY started_at,call_key', (ident,)).fetchall()
            tool_rows = c.execute('SELECT tool,state,payload FROM tool_operations WHERE job_id=? ORDER BY created_at,operation_key', (ident,)).fetchall()
            events = c.execute('SELECT seq,kind,payload,created_at FROM run_events WHERE job_id=? ORDER BY seq DESC LIMIT 60', (ident,)).fetchall()
            remaining = c.execute("SELECT id,priority FROM jobs WHERE status='queued' ORDER BY priority DESC,COALESCE(queued_at,created_at),id").fetchall()
            position = next((i+1 for i,x in enumerate(remaining) if x['id']==ident),None)
            usage = [json.loads(m['usage']) for m in models if m['state']=='completed' and m['usage']]
            consumed = sum(usage_tokens(u) or 0 for u in usage)
            estimated = sum(m['reserved_tokens'] for m in models if m['state'] in ('started','uncertain') or m['state']=='completed' and usage_tokens(json.loads(m['usage'] or '{}')) is None)
            obs = {'priority':r['priority'], 'priorityClass':'scheduled_patrol' if r['priority']==0 else 'interactive',
                'queuePosition':position, 'attemptCount':r['attempt_count'], 'queuedAt':r['queued_at'],
                'firstStartedAt':r['first_started_at'], 'lastClaimedAt':r['last_started_at'],
                'finishedAt':r['finished_at'],
                'cancellationPending':r['status']=='cancelled' and r['lease_owner'] is not None,
                'waitSeconds':round(r['wait_seconds']+(elapsed(r['queued_at'],now) if r['status']=='queued' else 0),3),
                'runSeconds':round(r['run_seconds']+(elapsed(r['started_at'],now) if r['lease_owner'] else 0),3),
                'inputHash':r['hash'], 'limits':unlimited_limits(json.loads(r['limits_json'])), 'budgetPolicy':'unlimited',
                'modelCalls':len(models), 'modelCallsCompleted':sum(m['state']=='completed' for m in models),
                'modelInvocations':c.execute("SELECT count(*) FROM run_events WHERE job_id=? AND kind='model_started'",(ident,)).fetchone()[0],
                'modelCallsUncertain':sum(m['state'] in ('started','uncertain') for m in models),
                'modelReplays':sum(1 for e in c.execute("SELECT 1 FROM run_events WHERE job_id=? AND kind='model_replayed'",(ident,))),
                'usage':usage, 'reportedTokens':consumed, 'estimatedOrReservedTokens':estimated,
                'tokenCountIsComplete':all(usage_tokens(u) is not None for u in usage) and not estimated,
                'toolCalls':len(tool_rows), 'toolFailures':[json.loads(t['payload']) for t in tool_rows if t['state']=='failed'],
                'errorCode':r['error_code'], 'retryable':bool(r['retryable']),
                'retryPolicy':'不自动重试模型；仅显式恢复已知失败，成功响应重放，状态未知阻止重发',
                'events':[event_projection(e,ident) for e in reversed(events)]}
            if result is not None:
                result['runtime'] = {k:v for k,v in obs.items() if k != 'events'}
            return {'id':ident,'status':r['status'],'steps':json.loads(r['steps']),
                    'result':result,'error':r['error'],'updatedAt':r['updated_at'],'observability':obs}


def worker_id():
    return 'worker-' + uuid.uuid4().hex

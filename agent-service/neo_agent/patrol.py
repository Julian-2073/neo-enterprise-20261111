"""Daily local patrols over a registered immutable snapshot; one worker only."""
from datetime import datetime, timezone, timedelta
import json, hashlib
from .engine import source_hash

def patrol_day(moment=None):
    return (moment or datetime.now(timezone.utc)).astimezone(timezone(timedelta(hours=8))).date().isoformat()

def register_watch(c,job,stamp):
    if not job.autoRepeat or job.purpose!='patrol':return
    key=job.businessId+':'+job.dataNature
    c.execute('INSERT INTO patrol_watches VALUES(?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET snapshot_id=excluded.snapshot_id,payload=excluded.payload,last_day=excluded.last_day,updated_at=excluded.updated_at',
              (key,job.snapshotId,json.dumps(job.model_dump(mode='json'),ensure_ascii=False),patrol_day(),stamp))

def enqueue_due(c,stamp,moment=None):
    day=patrol_day(moment)
    for row in c.execute('SELECT * FROM patrol_watches WHERE last_day<?',(day,)).fetchall():
        payload=json.loads(row['payload'])
        ident='run-auto-'+hashlib.sha256((row['scope']+payload['snapshotId']+source_hash(payload['envelope'])+day).encode()).hexdigest()[:32]
        payload.update(id=ident,sessionId='session-'+ident,history=[])
        c.execute("INSERT OR IGNORE INTO jobs(id,hash,payload,status,steps,result,error,created_at,updated_at) VALUES(?,?,?,'queued','[]',NULL,NULL,?,?)",(ident,source_hash(payload),json.dumps(payload,ensure_ascii=False),stamp,stamp))
        columns={r[1] for r in c.execute('PRAGMA table_info(jobs)')}
        if 'priority' in columns:
            from .job_queue import DEFAULT_LIMITS
            limits={**DEFAULT_LIMITS,**(payload.get('budget') or {})}
            c.execute('UPDATE jobs SET priority=0,queued_at=COALESCE(queued_at,?),limits_json=COALESCE(limits_json,?) WHERE id=?',(stamp,json.dumps(limits),ident))
        c.execute('UPDATE patrol_watches SET last_day=?,updated_at=? WHERE scope=?',(day,stamp,row['scope']))

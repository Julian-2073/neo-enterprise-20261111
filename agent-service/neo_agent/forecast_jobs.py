"""A durable, fenced one-process forecast lane, separate from chat workers."""
import asyncio
import hashlib
import json
import os
import re
import signal
import sqlite3
import subprocess
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import FileResponse

router = APIRouter(prefix='/forecast-jobs')
def clock(): return datetime.now(timezone.utc).isoformat()

class ForecastQueue:
    def __init__(self, root): self.root = Path(root); self.root.mkdir(parents=True, exist_ok=True)
    @contextmanager
    def db(self):
        c = sqlite3.connect(self.root/'queue.sqlite', timeout=10); c.row_factory = sqlite3.Row
        try:
            c.execute('BEGIN IMMEDIATE'); yield c; c.commit()
        except BaseException: c.rollback(); raise
        finally: c.close()
    def initialize(self, recover=False):
        with self.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,business TEXT,nature TEXT,token TEXT,digest TEXT,status TEXT,payload TEXT,error TEXT,created TEXT,updated TEXT)')
            if recover: c.execute("UPDATE jobs SET status='failed',error='WORKER_INTERRUPTED',updated=? WHERE status='running'", (clock(),))
    def submit(self, body):
        ident = body.get('id', ''); d = body.get('dataset', {}); budget = body.get('budgetSeconds', 180)
        if not re.fullmatch(r'forecast-job-[a-f0-9]{64}', ident) or not isinstance(body.get('controlToken'), str) or len(body['controlToken']) != 64 or not isinstance(budget, int) or not 30 <= budget <= 600:
            raise HTTPException(422, 'FORECAST_JOB_SCHEMA')
        if d.get('dataNature') not in ('business', 'demo') or not isinstance(d.get('businessId'), str) or not d.get('generationId') or len(json.dumps(d)) > 8*1024*1024:
            raise HTTPException(422, 'FORECAST_SCOPE')
        digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        with self.db() as c:
            old = c.execute('SELECT digest FROM jobs WHERE id=?', (ident,)).fetchone()
            if old:
                if old['digest'] != digest: raise HTTPException(409, 'FORECAST_REQUEST_CONFLICT')
                return
            if c.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0] >= 16: raise HTTPException(429, 'FORECAST_QUEUE_FULL')
            now = clock(); c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)', (ident, d['businessId'], d['dataNature'], body['controlToken'], digest, 'queued', json.dumps(body), None, now, now))
    def scoped(self, ident, business, nature, token):
        with self.db() as c: row = c.execute('SELECT * FROM jobs WHERE id=? AND business=? AND nature=? AND token=?', (ident, business, nature, token)).fetchone()
        if not row: raise HTTPException(404, 'FORECAST_JOB_NOT_FOUND')
        return dict(row)
    def cancel(self, ident, business, nature, token):
        self.scoped(ident, business, nature, token)
        with self.db() as c: c.execute("UPDATE jobs SET status='cancelled',updated=? WHERE id=? AND token=? AND status IN ('queued','running')", (clock(), ident, token))
    def claim(self):
        with self.db() as c:
            row = c.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created,id LIMIT 1").fetchone()
            if row: c.execute("UPDATE jobs SET status='running',updated=? WHERE id=? AND status='queued'", (clock(), row['id']))
        return dict(row) if row else None
    def finish(self, row, status, error=None):
        with self.db() as c: c.execute("UPDATE jobs SET status=?,error=?,updated=? WHERE id=? AND token=? AND status='running'", (status, error, clock(), row['id'], row['token']))

def queue():
    root = os.getenv('NEO_FORECAST_ROOT') or str(Path(os.environ.get('NEO_AGENT_DB', 'agent-service/state/agent.sqlite')).parent/'forecast')
    q = ForecastQueue(root); q.initialize(); return q

@router.post('')
def submit(body: dict):
    queue().submit(body)
    return {'id': body['id'], 'status': 'queued'}

@router.get('/{ident}')
def observe(ident: str, businessId: str, dataNature: str, controlToken: str = Header(alias="X-Forecast-Control")):
    q = queue(); row = q.scoped(ident, businessId, dataNature, controlToken)
    value = {k: row[k] for k in ('id', 'status', 'error', 'created', 'updated')}
    if row['status'] == 'completed': value['result'] = json.loads((q.root/ident/'result.json').read_text())
    return value

@router.post('/{ident}/cancel')
def cancel(ident: str, body: dict):
    queue().cancel(ident, body.get('businessId'), body.get('dataNature'), body.get('controlToken'))
    return {'id': ident, 'status': 'cancelled'}

@router.get('/{ident}/models')
def models(ident: str, businessId: str, dataNature: str, controlToken: str = Header(alias="X-Forecast-Control")):
    q = queue(); row = q.scoped(ident, businessId, dataNature, controlToken)
    if row['status'] != 'completed': raise HTTPException(409, 'FORECAST_NOT_READY')
    return FileResponse(q.root/ident/'models.zip', media_type='application/zip')

async def worker():
    q = queue(); q.initialize(recover=True)
    python = os.getenv('NEO_FORECAST_PYTHON', str(Path(__file__).resolve().parents[1]/'.forecast-venv/bin/python'))
    while True:
        row = q.claim()
        if not row: await asyncio.sleep(.3); continue
        folder = q.root/row['id']; folder.mkdir(exist_ok=True); source = folder/'input.json'; dest = folder/'result.json'
        source.write_text(row['payload']); payload = json.loads(row['payload']); process = None
        try:
            if not Path(python).is_file(): raise FileNotFoundError('FORECAST_ENV_UNAVAILABLE')
            env = {k: v for k, v in os.environ.items() if k not in ('LLM_API_KEY', 'TAVILY_API_KEY', 'NEO_SERVICE_TOKEN')}
            env.update(PYTHONPATH=str(Path(__file__).resolve().parents[1]), OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')
            with open(folder/'worker.log', 'wb') as log:
                process = subprocess.Popen([python, '-m', 'neo_agent.forecast_compute', str(source), str(dest)], stdout=log, stderr=log, env=env, start_new_session=True)
                started = time.monotonic()
                while process.poll() is None:
                    current = q.scoped(row['id'], row['business'], row['nature'], row['token'])
                    if current['status'] == 'cancelled': break
                    if time.monotonic()-started > payload['budgetSeconds']:
                        q.finish(row, 'failed', 'BUDGET_EXCEEDED'); break
                    await asyncio.sleep(.2)
                if process.poll() == 0 and dest.is_file(): q.finish(row, 'completed')
                elif process.poll() is not None: q.finish(row, 'failed', 'MODEL_COMPUTATION_FAILED')
        except asyncio.CancelledError:
            q.finish(row, 'failed', 'WORKER_INTERRUPTED'); raise
        except Exception as e: q.finish(row, 'failed', 'FORECAST_ENV_UNAVAILABLE' if isinstance(e, FileNotFoundError) else 'FORECAST_WORKER_FAILED')
        finally:
            if process and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try: await asyncio.to_thread(process.wait, timeout=2)
                except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); await asyncio.to_thread(process.wait)

"""One bounded solver lane, also callable by the LLM against a pinned problem."""
import asyncio
import copy
import hashlib
import json
import os
import signal
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix='/operating-plans')
lane = asyncio.Semaphore(1)


async def compute_problem(problem):
    if not isinstance(problem, dict) or problem.get('version') != 'operating-planner-v1' or len(json.dumps(problem, allow_nan=False)) > 1024*1024:
        raise ValueError('PLANNER_INPUT_BUDGET')
    try: await asyncio.wait_for(lane.acquire(), timeout=2)
    except TimeoutError: raise ValueError('PLANNER_BUSY')
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix='neo-planner-') as folder:
            source, dest = Path(folder)/'input.json', Path(folder)/'result.json'
            source.write_text(json.dumps({'problem': problem, 'budgetSeconds': 8}, allow_nan=False))
            python = os.getenv('NEO_FORECAST_PYTHON', str(Path(__file__).resolve().parents[1]/'.forecast-venv/bin/python'))
            env = {k: v for k, v in os.environ.items() if k not in ('LLM_API_KEY', 'TAVILY_API_KEY', 'NEO_SERVICE_TOKEN')}
            env.update(PYTHONPATH=str(Path(__file__).resolve().parents[1]), OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')
            with open(Path(folder)/'solver.log', 'wb') as log:
                process = await asyncio.create_subprocess_exec(python, '-m', 'neo_agent.operating_optimizer', str(source), str(dest), stdout=log, stderr=log, env=env, start_new_session=True)
                await asyncio.wait_for(process.wait(), timeout=15)
            if process.returncode or not dest.is_file(): raise ValueError('PLANNER_COMPUTATION_FAILED')
            return json.loads(dest.read_text())
    finally:
        if process and process.returncode is None:
            try: os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: await asyncio.wait_for(process.wait(), timeout=2)
            except TimeoutError:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                await process.wait()
        lane.release()


@router.post('')
async def compute(body: dict):
    try: return await compute_problem(body.get('problem'))
    except (ValueError, TimeoutError, FileNotFoundError) as e:
        raise HTTPException(429 if str(e) == 'PLANNER_BUSY' else 422, str(e) if isinstance(e, ValueError) else 'PLANNER_SERVICE_UNAVAILABLE') from e


def frozen_plan(env):
    plan = env.get('operatingPlanning')
    snapshot = env['snapshot']
    if not plan:
        raise ValueError('尚无冻结经营任务；请在生意预测中保存目标、补货条件并完成联合求解')
    problem = plan['problem']
    if problem['businessId'] != snapshot['businessId'] or problem['dataNature'] != snapshot['dataNature'] or problem['generationId'] != snapshot['id']:
        raise ValueError('经营任务与当前授权快照不一致')
    return plan


def read_plan(env):
    plan = frozen_plan(env); p = plan['problem']
    return {'id': plan['id'], 'businessId': p['businessId'], 'dataNature': p['dataNature'], 'generationId': p['generationId'],
            'mission': p['mission'], 'environment': p['environment'], 'coverage': p['coverage'],
            'forecastJobId': p['forecastJobId'], 'assumptionSetId': p['assumptionSetId'],
            'actionSpace': [{'sku': g['id'], 'quantityGrid': [o['quantity'] for o in g['options']],
                             'conditions': next((o['action'] for o in g['options'] if o['action']), None)} for g in p['groups']],
            'savedSolution': plan['solution'], 'feedback': plan.get('feedback', []), 'limitations': p['limitations'], 'evidenceIds': [plan['id']]}


async def optimize_plan(env, args):
    plan = frozen_plan(env); p = copy.deepcopy(plan['problem'])
    if set(args)-{'goal', 'riskAversion'}: raise ValueError('LLM不能改变预算、交期、服务底线或供货价格')
    goal = args.get('goal', p['mission']['goal']); risk = args.get('riskAversion', p['mission']['riskAversion'])
    if goal not in ('contribution_margin', 'service') or not isinstance(risk, (int, float)) or isinstance(risk, bool) or not p['mission']['riskAversion'] <= risk <= 2:
        raise ValueError('方向或风险偏好超出任务授权；不能降低已保存的风险约束')
    p['mission'].update(goal=goal, riskAversion=risk)
    result = await compute_problem(p)
    ident = 'operating-preview-'+hashlib.sha256(json.dumps([plan['id'], goal, risk], sort_keys=True).encode()).hexdigest()
    return {'id': ident, 'planningId': plan['id'], 'businessId': p['businessId'], 'dataNature': p['dataNature'],
            'generationId': p['generationId'], 'forecastJobId': p['forecastJobId'], 'assumptionSetId': p['assumptionSetId'],
            'solution': result, 'environment': p['environment'], 'coverage': p['coverage'],
            'limitations': p['limitations'], 'evidenceIds': [plan['id'], ident], 'executionStatus': 'draft_only'}

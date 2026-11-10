"""Bounded stochastic multiple-choice MILP over an explicit action grid.

Profit is precomputed by the frozen fulfillment policy, not a perfect-foresight
recourse allocation. Cash investment and additional expense are separate inputs.
"""
import hashlib
import importlib.metadata
import json
import math
import sys
import time
from pathlib import Path

VERSION = 'operating-planner-v1'


def validate(problem):
    if not isinstance(problem, dict) or problem.get('version') != VERSION:
        raise ValueError('PLANNER_VERSION')
    mission = problem.get('mission', {})
    if mission.get('goal') not in ('contribution_margin', 'service') or not isinstance(mission.get('cashBudgetCents'), int) or not 0 <= mission['cashBudgetCents'] <= 10**10:
        raise ValueError('PLANNER_MISSION')
    if any(not isinstance(mission.get(k), (int, float)) or isinstance(mission[k], bool) or not math.isfinite(mission[k]) or not 0 <= mission[k] <= limit
           for k, limit in [('minFillRate', 1), ('riskAversion', 2)]):
        raise ValueError('PLANNER_MISSION')
    samples = len(problem.get('base', {}).get('requested', []))
    if samples != 32 or any(len(problem['base'].get(k, [])) != samples for k in ('margin', 'fulfilled')):
        raise ValueError('PLANNER_SAMPLES')
    groups = problem.get('groups', [])
    if not 1 <= len(groups) <= 8 or len({g['id'] for g in groups}) != len(groups):
        raise ValueError('PLANNER_GROUPS')
    options = [o for g in groups for o in g['options']]
    if len(options) > 136 or len({o['id'] for o in options}) != len(options) or any(not 1 <= len(g['options']) <= 17 for g in groups):
        raise ValueError('PLANNER_OPTIONS')
    for o in options:
        if not isinstance(o['cashCents'], int) or not 0 <= o['cashCents'] <= 10**10 or not isinstance(o['quantity'], int) or not 0 <= o['quantity'] <= 10000:
            raise ValueError('PLANNER_ACTION')
        if any(len(o.get(k, [])) != samples for k in ('deltaMargin', 'deltaFulfilled')):
            raise ValueError('PLANNER_SAMPLES')
    numbers = [v for k in ('margin', 'fulfilled', 'requested') for v in problem['base'][k]] + [v for o in options for k in ('deltaMargin', 'deltaFulfilled') for v in o[k]]
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > 10**12 for v in numbers):
        raise ValueError('PLANNER_VALUES')
    if any(a < 0 or f < 0 or f > a for a, f in zip(problem['base']['requested'], problem['base']['fulfilled'])):
        raise ValueError('PLANNER_DEMAND')
    return options, samples


def tail_mean(values, mass=.1):
    """Fractional empirical lower tail, including a partial boundary observation."""
    ordered = sorted(values); count = len(ordered)*mass; whole = int(count)
    return (sum(ordered[:whole])+(count-whole)*ordered[whole])/count


def solve(problem, budget_seconds=8):
    import numpy as np
    from scipy.optimize import milp, LinearConstraint, Bounds
    from scipy.sparse import csr_matrix
    started = time.monotonic(); options, samples = validate(problem)
    goal = problem['mission']['goal']; risk = problem['mission']['riskAversion']
    n = len(options); width = n+1+samples; eta = n
    margin = np.array([o['deltaMargin'] for o in options], dtype=float).T
    fulfilled = np.array([o['deltaFulfilled'] for o in options], dtype=float).T
    baseline = np.asarray(problem['base']['margin' if goal == 'contribution_margin' else 'fulfilled'], dtype=float)
    payoffs = margin if goal == 'contribution_margin' else fulfilled
    # Yuan for the economic objective; all stored input and result money remains cents.
    scale = 100 if goal == 'contribution_margin' else 1
    payoffs = payoffs/scale; baseline = baseline/scale
    cash = np.asarray([o['cashCents'] for o in options], dtype=float)
    objective = np.zeros(width); objective[:n] = -payoffs.mean(axis=0)
    objective[eta] = risk; objective[n+1:] = risk/(samples*.1)
    rows, lower, upper = [], [], []
    position = 0
    for group in problem['groups']:
        row = np.zeros(width); row[position:position+len(group['options'])] = 1
        rows.append(row); lower.append(1); upper.append(1); position += len(group['options'])
    row = np.zeros(width); row[:n] = cash/100
    rows.append(row); lower.append(-np.inf); upper.append(problem['mission']['cashBudgetCents']/100)
    mean_requested = float(np.mean(problem['base']['requested']))
    service_needed = problem['mission']['minFillRate']*mean_requested-float(np.mean(problem['base']['fulfilled']))
    row = np.zeros(width); row[:n] = fulfilled.mean(axis=0)
    rows.append(row); lower.append(service_needed); upper.append(np.inf)
    for index in range(samples):
        row = np.zeros(width); row[:n] = -payoffs[index]; row[eta] = -1; row[n+1+index] = -1
        rows.append(row); lower.append(-np.inf); upper.append(baseline[index])
    lo = np.zeros(width); lo[eta] = -np.inf
    hi = np.full(width, np.inf); hi[:n] = 1
    bounds = Bounds(lo, hi); integrality = np.zeros(width); integrality[:n] = 1
    constraint = LinearConstraint(csr_matrix(np.asarray(rows)), np.asarray(lower), np.asarray(upper))
    fitted = milp(objective, integrality=integrality, bounds=bounds, constraints=constraint,
                  options={'time_limit': max(.1, budget_seconds*.65), 'mip_rel_gap': 0.0})
    if fitted.status == 0 and fitted.x is not None:
        # Lexicographic tie break: lowest cash among equally good risk-adjusted choices.
        tie_objective = np.zeros(width); tie_objective[:n] = cash/100
        tied = milp(tie_objective, integrality=integrality, bounds=bounds,
                    constraints=[constraint, LinearConstraint(objective[None, :], -np.inf, fitted.fun+1e-7)],
                    options={'time_limit': max(.1, budget_seconds-(time.monotonic()-started)), 'mip_rel_gap': 0.0})
        if tied.status == 0 and tied.x is not None: fitted.x = tied.x
    if fitted.status not in (0, 1, 2) or fitted.status == 1 and fitted.x is None:
        raise ValueError('PLANNER_SOLVER_FAILED')
    status = 'optimal' if fitted.status == 0 else 'time_limit' if fitted.status == 1 else 'infeasible'
    selected = []
    if status != 'infeasible':
        chosen = np.rint(fitted.x[:n])
        if np.max(np.abs(chosen-fitted.x[:n])) > 1e-5 or any(sum(chosen[sum(len(g['options']) for g in problem['groups'][:i]):sum(len(g['options']) for g in problem['groups'][:i+1])]) != 1 for i in range(len(problem['groups']))):
            raise ValueError('PLANNER_NONINTEGER')
        selected = [o for o, bit in zip(options, chosen) if bit == 1]
    profits = [problem['base']['margin'][i]+sum(o['deltaMargin'][i] for o in selected) for i in range(samples)]
    units = [problem['base']['fulfilled'][i]+sum(o['deltaFulfilled'][i] for o in selected) for i in range(samples)]
    cash_used = sum(o['cashCents'] for o in selected)
    fill = float(np.mean(units))/mean_requested if mean_requested > 0 else None
    if selected and (cash_used > problem['mission']['cashBudgetCents'] or any(u < -1e-5 or u > a+1e-5 for u, a in zip(units, problem['base']['requested'])) or fill is not None and fill+1e-7 < problem['mission']['minFillRate']):
        raise ValueError('PLANNER_POSTCONDITION')
    feasible = status != 'infeasible'
    return dict(version=VERSION, status=status, selectedOptionIds=[o['id'] for o in selected],
                actions=[o['action'] for o in selected if o['action']], goal=goal, riskAversion=risk,
                cashCents=cash_used, expectedMarginCents=float(np.mean(profits)) if feasible else None,
                expectedFulfilled=float(np.mean(units)) if feasible else None, expectedRequested=mean_requested,
                expectedFillRate=fill if feasible else None,
                conditionalMarginRange=np.quantile(profits, [.1, .5, .9]).tolist() if feasible else None,
                conditionalFulfilledRange=np.quantile(units, [.1, .5, .9]).tolist() if feasible else None,
                downsideMarginCents=tail_mean(profits) if feasible else None,
                solver={'name': 'scipy.milp/HiGHS', 'version': importlib.metadata.version('scipy'),
                        'gap': float(fitted.mip_gap) if getattr(fitted, 'mip_gap', None) is not None else None,
                        'codeHash': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                        'seconds': time.monotonic()-started, 'optimalWithinDeclaredGrid': status == 'optimal'},
                notice='声明数量档与条件样本内的风险约束求解；条件分位数不是校准预测区间，采购仍为行动草案。' if feasible else '预算、数量范围或服务目标之间无可行组合；不能降低约束后冒充原目标通过。',
                executionStatus='draft_only')


if __name__ == '__main__':
    source, dest = map(Path, sys.argv[1:3]); payload = json.loads(source.read_text())
    value = solve(payload['problem'], min(10, payload.get('budgetSeconds', 8)))
    dest.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))

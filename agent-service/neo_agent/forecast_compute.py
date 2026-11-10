"""Bounded CPU forecasting; no language model, network or enterprise writes."""
import hashlib
import importlib.metadata
import json
import math
import os
import pickle
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

VERSION = 'enterprise-paid-v1'
MODELS = ('four_week_mean', 'last_week', 'weekday_mean_4', 'auto_ets', 'croston_sba', 'mlforecast_lightgbm')
PARAMS = {'four_week_mean': {'days': 28}, 'last_week': {'seasonLength': 7}, 'weekday_mean_4': {'weeks': 4},
          'auto_ets': {'season_length': 7, 'model': 'ZZZ'}, 'croston_sba': {},
          'mlforecast_lightgbm': {'lags': [1, 7, 14, 28], 'rollingMeans': [7, 28], 'dateFeatures': ['dayofweek', 'month'], 'n_estimators': 100, 'num_leaves': 15, 'threads': 1}}
PARAMS['autogluon_timeseries'] = {'candidates': ['SeasonalNaive', 'RecursiveTabular_GBM', 'DirectTabular_GBM', 'WeightedEnsemble'], 'knownCovariates': ['weekday', 'weekend'], 'internalValidationWindows': 1, 'networkModels': False, 'dependencyEnvironment': 'isolated'}

def autogluon_batch(data, directory, budget):
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    # The isolated adapter receives historical features only, never outer labels.
    def features(window):
        return {**{k: window[k] for k in ('origin', 'dates')}, 'series': [
            {k: s[k] for k in ('id', 'entityId', 'channelId', 'values')} for s in window['series']]}
    dataset = {'horizonDays': data['horizonDays'], 'current': features(data['current']),
               'windows': [features(w) for w in data['windows']]}
    source, dest = directory/'input.json', directory/'result.json'
    source.write_text(json.dumps({'dataset': dataset, 'budgetSeconds': budget}, allow_nan=False))
    python = os.getenv('NEO_AUTOGLUON_PYTHON', str(Path(__file__).resolve().parents[1]/'.autogluon-venv/bin/python'))
    with open(directory/'adapter.log', 'wb') as log:
        proc = subprocess.run([python, '-m', 'neo_agent.forecast_autogluon', str(source), str(dest), str(directory/'models')],
                              stdout=log, stderr=log, timeout=budget,
                              env={**os.environ, 'HF_HUB_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1', 'OMP_NUM_THREADS': '1'})
    if proc.returncode or not dest.is_file(): raise ValueError('AUTOGLUON_FIT_FAILED')
    return json.loads(dest.read_text())

def score(cells):
    n = len(cells); actual = sum(a for a, _ in cells); predicted = sum(p for _, p in cells)
    error = sum(abs(a-p) for a, p in cells)
    return dict(wape=error/actual if actual > 0 else None, bias=(predicted-actual)/actual if actual > 0 else None,
                mae=error/n if n else None, cells=n, actual=actual, predicted=predicted)

def adapter(model, window, horizon, artifact=None):
    import numpy as np
    result = {}
    fitted = {}
    if model == 'mlforecast_lightgbm':
        import pandas as pd
        from lightgbm import LGBMRegressor
        from mlforecast import MLForecast
        from mlforecast.lag_transforms import RollingMean
        entities = {v: i for i, v in enumerate(sorted({s['entityId'] for s in window['series']}))}
        channels = {v: i for i, v in enumerate(sorted({s['channelId'] for s in window['series']}))}
        rows = [dict(unique_id=s['id'], ds=d, y=y, entity_code=entities[s['entityId']], channel_code=channels[s['channelId']])
                for s in window['series'] for d, y in zip(window['dates'], s['values'])]
        df = pd.DataFrame(rows); df['ds'] = pd.to_datetime(df['ds'])
        fitted = MLForecast(models={'tree': LGBMRegressor(n_estimators=100, num_leaves=15, min_child_samples=5, n_jobs=1,
                             random_state=0, deterministic=True, force_col_wise=True, verbosity=-1)}, freq='D',
                             lags=[1, 7, 14, 28], lag_transforms={1: [RollingMean(7), RollingMean(28)]}, date_features=['dayofweek', 'month'], num_threads=1)
        fitted.fit(df, static_features=['entity_code', 'channel_code'])
        frame = fitted.predict(h=horizon)
        for s in window['series']:
            result[s['id']] = frame[frame.unique_id == s['id']].sort_values('ds')['tree'].to_numpy()
    else:
        if model in ('auto_ets', 'croston_sba'):
            from statsforecast.models import AutoETS, CrostonSBA
        for s in window['series']:
            y = np.asarray(s['values'], dtype=float); recent = y[-28:]
            if model == 'four_week_mean': values = np.full(horizon, recent.mean())
            elif model == 'last_week': values = np.resize(y[-7:], horizon)
            elif model == 'weekday_mean_4': values = np.resize(recent.reshape(4, 7).mean(axis=0), horizon)
            else:
                fit = (AutoETS(season_length=7) if model == 'auto_ets' else CrostonSBA()).fit(y)
                fitted[s['id']] = fit
                values = fit.predict(h=horizon)['mean']
            result[s['id']] = values
        if model in MODELS[:3]: fitted = {'method': model, 'window': window, 'horizon': horizon}
    for key, values in result.items():
        if len(values) != horizon or not np.isfinite(values).all(): raise ValueError('NONFINITE_PREDICTION')
        result[key] = np.maximum(values, 0).tolist()
    if artifact:
        with open(artifact, 'wb') as f: pickle.dump(fitted, f, protocol=5)
    return result

def compute(data, out_dir=None, budget_seconds=180):
    import numpy as np
    started = time.monotonic(); h = data['horizonDays']; windows = data['windows']; current = data['current']
    if data.get('version') != VERSION or h not in (7, 28) or not 1 <= len(current['series']) <= 64 or len(windows) > 11:
        raise ValueError('DATASET_BUDGET')
    for w in [current, *windows]:
        if len(w['dates']) != 84 or any(len(s['values']) != 84 or len(s['actual']) not in (0, h) or any(not math.isfinite(y) or y < 0 for y in s['values']+s['actual']) for s in w['series']):
            raise ValueError('DATASET_SCHEMA')
    models = tuple(data.get('modelIds', MODELS))
    if not models or models[0] != 'four_week_mean' or len(set(models)) != len(models) or any(m not in (*MODELS, 'autogluon_timeseries') for m in models):
        raise ValueError('MODEL_SELECTION')
    failures = {}; selection_failures = set(); predictions = {}; folds = []; aggregates = {m: {'selection': [], 'test': []} for m in models}
    ag = None
    # A batch amortizes imports and shares one hard deadline across every fold.
    temporary = tempfile.TemporaryDirectory() if not out_dir else None
    ag_directory = Path(out_dir or temporary.name)/'autogluon'
    if 'autogluon_timeseries' in models:
        try: ag = autogluon_batch(data, ag_directory, max(5, int(budget_seconds*.7)))
        except Exception as e:
            failures['autogluon_timeseries'] = type(e).__name__
            selection_failures.add('autogluon_timeseries')
    def prediction(model, window, key, artifact=None):
        if model != 'autogluon_timeseries': return adapter(model, window, h, artifact)
        if not ag: raise ValueError('AUTOGLUON_UNAVAILABLE')
        values = ag['predictions'][key]
        if set(values) != {s['id'] for s in window['series']} or any(len(v) != h or not np.isfinite(v).all() or any(x<0 for x in v) for v in values.values()):
            raise ValueError('AUTOGLUON_VALUES')
        return values
    for wi, w in enumerate(windows):
        metrics = {}; predictions[wi] = {}
        for m in models:
            if time.monotonic()-started > budget_seconds: raise TimeoutError('BUDGET_EXCEEDED')
            try:
                p = prediction(m, w, str(wi)); predictions[wi][m] = p
                cells = [(a, b) for s in w['series'] for a, b in zip(s['actual'], p[s['id']])]
                metrics[m] = score(cells)
                if w['role'] in ('selection', 'test'): aggregates[m][w['role']].extend(cells)
            except Exception as e:
                failures[m] = type(e).__name__  # Provider/library logs and local paths never enter product messages.
                if w['role'] == 'selection': selection_failures.add(m)
        folds.append(dict(role=w['role'], origin=w['origin'], metrics=metrics))
    selection = {m: score(v['selection']) for m, v in aggregates.items()}
    valid = [m for m in models if m not in selection_failures and selection[m]['wape'] is not None]
    # Only earlier internal windows choose the model; never inspect test or calibration errors here.
    selected = min(valid, key=lambda m: (selection[m]['wape'], models.index(m))) if valid else 'four_week_mean'
    output_predictions = {}; artifact_paths = []
    for m in models:
        if time.monotonic()-started > budget_seconds: raise TimeoutError('BUDGET_EXCEEDED')
        try:
            file = Path(out_dir)/f'{m}.pkl' if out_dir and m!='autogluon_timeseries' else None
            output_predictions[m] = prediction(m, current, 'current', file)
            if file: artifact_paths.append(file)
        except Exception as e: failures[m] = type(e).__name__
    if selected not in output_predictions: selected = 'four_week_mean'
    if selected not in output_predictions: raise ValueError('BASELINE_FAILED')
    calibration = [(wi, w) for wi, w in enumerate(windows) if w['role'] == 'calibration' and selected in predictions[wi]]
    tests = [(wi, w) for wi, w in enumerate(windows) if w['role'] == 'test' and selected in predictions[wi]]
    residuals = {}; baseline_residuals = {}; joint_blocks = []
    for wi, w in calibration:
        block = {}
        for s in w['series']:
            errors = [a-p for a, p in zip(s['actual'], predictions[wi][selected][s['id']])]
            residuals.setdefault(s['id'], []).extend(abs(e) for e in errors); block[s['id']] = errors
            bp = predictions[wi].get('four_week_mean', {}).get(s['id'])
            if bp: baseline_residuals.setdefault(s['id'], []).extend(abs(a-p) for a, p in zip(s['actual'], bp))
        joint_blocks.append(block)
    nominal = .8; quantiles = {}
    for key, errors in residuals.items():
        if len(calibration) >= 3 and len(errors) >= 3*h:
            # Finite-sample adjusted rank; exchangeability is an assumption, not a temporal guarantee.
            rank = min(len(errors), math.ceil((len(errors)+1)*nominal))
            quantiles[key] = sorted(errors)[rank-1]
    baseline_quantiles = {key: sorted(errors)[min(len(errors), math.ceil((len(errors)+1)*nominal))-1] for key, errors in baseline_residuals.items() if len(calibration)>=3 and len(errors)>=3*h}
    widths = []; losses = []; covered = []; block_coverages = []; baseline_widths = []; baseline_losses = []
    group_cells = {}
    for wi, w in tests:
        block_covered = []
        for s in w['series']:
            p = predictions[wi][selected][s['id']]
            baseline = predictions[wi].get('four_week_mean', {}).get(s['id'])
            if baseline: group_cells.setdefault(s['id'], [[], []]); group_cells[s['id']][0].extend(zip(s['actual'], baseline)); group_cells[s['id']][1].extend(zip(s['actual'], p))
            if s['id'] not in quantiles: continue
            q = quantiles[s['id']]
            for a, b in zip(s['actual'], p):
                lo, hi = max(0, b-q), b+q; ok = lo <= a <= hi
                covered.append(ok); block_covered.append(ok); widths.append(hi-lo)
                losses.append((hi-lo)+10*max(lo-a, 0)+10*max(a-hi, 0))
            if baseline and s['id'] in baseline_quantiles:
                q = baseline_quantiles[s['id']]
                for a, b in zip(s['actual'], baseline):
                    lo, hi = max(0, b-q), b+q; baseline_widths.append(hi-lo); baseline_losses.append(hi-lo+10*max(lo-a,0)+10*max(a-hi,0))
        if block_covered: block_coverages.append(sum(block_covered)/len(block_covered))
    test_scores = {m: score(v['test']) for m, v in aggregates.items()}; base = test_scores['four_week_mean']; chosen = test_scores[selected]
    rules = dict(relativeImprovement=.10, minTestBlocks=6, minWinningBlocks=4, maxAbsBias=.05, maxGroupRegression=.05, minCoverage=.75, maxCoverage=.85, minForwardCycles=3)
    wins = sum(f['metrics'].get(selected, {}).get('mae', float('inf')) < f['metrics'].get('four_week_mean', {}).get('mae', 0) for f in folds if f['role'] == 'test' and selected in f['metrics'] and 'four_week_mean' in f['metrics'])
    reasons = []
    if selected in failures: reasons.append('候选模型在部分窗口失败，保留基线')
    if data['domain'] != 'as_of': reasons.append('历史重建不能作为当时可见的生产晋级证据')
    if len(tests) < 6 or wins < 4: reasons.append('独立测试窗口或胜出窗口不足')
    if base['wape'] is None or base['wape'] == 0 or chosen['wape'] is None or chosen['wape'] > base['wape']*.9: reasons.append('外层误差尚未相对有效基线改善10%')
    if chosen['bias'] is None or abs(chosen['bias']) > .05: reasons.append('系统偏差未通过5%门槛')
    regressions = [key for key, (b, c) in group_cells.items() if (score(b)['wape'] is not None and score(c)['wape'] is not None and score(c)['wape'] > max(score(b)['wape']*1.05, score(b)['wape']))]
    if regressions: reasons.append('存在误差恶化的SKU分组，需要单独复核')
    coverage = sum(covered)/len(covered) if covered else None
    if coverage is None or not .75 <= coverage <= .85 or len(quantiles) != len(current['series']): reasons.append('区间覆盖或当前序列校准范围未通过')
    mean_width = sum(widths)/len(widths) if widths else None
    interval_score = sum(losses)/len(losses) if losses else None
    baseline_width = sum(baseline_widths)/len(baseline_widths) if baseline_widths else None
    baseline_score = sum(baseline_losses)/len(baseline_losses) if baseline_losses else None
    if mean_width is None or baseline_width is None or interval_score is None or baseline_score is None or mean_width>baseline_width*1.05 or interval_score>baseline_score*1.05:
        reasons.append('区间宽度或区间评分没有通过有效基线保护')
    points = []
    for s in current['series']:
        q = quantiles.get(s['id'])
        for i, value in enumerate(output_predictions[selected][s['id']]):
            points.append(dict(date=(date.fromisoformat(data['origin'])+timedelta(days=i+1)).isoformat(), entityId=s['entityId'], channelId=s['channelId'], value=value, lower=max(0, value-q) if q is not None else None, upper=value+q if q is not None else None))
    # Whole residual windows are sampled jointly for all SKUs, retaining observed cross-series/time dependence.
    # These are empirical scenario paths, not calibrated joint probability quantiles.
    samples = []; rng = np.random.default_rng(0)
    if len(joint_blocks) >= 3 and all(all(s['id'] in b for s in current['series']) for b in joint_blocks):
        for _ in range(32):
            block = joint_blocks[int(rng.integers(len(joint_blocks)))]; path = []
            for s in current['series']:
                for i, p in enumerate(output_predictions[selected][s['id']]): path.append(dict(date=(date.fromisoformat(data['origin'])+timedelta(days=i+1)).isoformat(), entityId=s['entityId'], channelId=s['channelId'], value=max(0, p+block[s['id']][i])))
            samples.append(path)
    registry = dict(codeHash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), featureSchema='paid-daily-lagged-calendar-static-v1',
                    dependencies={p: importlib.metadata.version(p) for p in ('statsforecast', 'mlforecast', 'lightgbm', 'numpy', 'pandas')}, seed=0,
                    trainingStart=current['dates'][0], trainingEnd=current['dates'][-1])
    if ag:
        registry['autogluon'] = {k: ag[k] for k in ('models', 'dependencies', 'codeHash')}
        registry['codeHash'] = hashlib.sha256((registry['codeHash']+ag['codeHash']).encode()).hexdigest()
    if out_dir:
        bundle = Path(out_dir)/'models.zip'
        with zipfile.ZipFile(bundle, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for file in artifact_paths: z.write(file, file.name)
            if ag:
                for file in sorted((ag_directory/'models'/'current').rglob('*')):
                    if file.is_file() and file.suffix != '.log': z.write(file, 'autogluon/'+str(file.relative_to(ag_directory/'models'/'current')))
        registry.update(modelArtifactSha256=hashlib.sha256(bundle.read_bytes()).hexdigest(), modelArtifactBytes=bundle.stat().st_size)
    return dict(version=VERSION, businessId=data['businessId'], dataNature=data['dataNature'], generationId=data['generationId'], target='paid_units', pointMeaning='mean',
                origin=data['origin'], dataCutoff=data['dataCutoff'], issuedAt=datetime.now(timezone.utc).isoformat(), horizonDays=h, domain=data['domain'], selectedModel=selected, points=points,
                models=[dict(id=m, status='failed' if m in failures else 'completed', **({'reason': failures[m]} if m in failures else {}), selection=selection[m], test=test_scores[m], params=PARAMS[m]) for m in models], folds=folds,
                interval=dict(status='calibrated' if len(quantiles)==len(current['series']) else 'partially_calibrated' if quantiles else 'unavailable', method='split-absolute-residual-per-leaf', nominalCoverage=nominal, coverage=coverage,
                              meanWidth=mean_width, wis=None, intervalScore=interval_score, baselineWidth=baseline_width, baselineIntervalScore=baseline_score, calibrationBlocks=len(calibration), testBlocks=len(block_coverages),
                              reason='按叶子序列校准；实测覆盖须结合独立时间块数，不能宣称总量区间或未来覆盖保证。' if quantiles else '独立校准窗不足，或当前序列未覆盖；区间保持未知。'),
                promotion=dict(status='baseline_only' if reasons else 'shadow_eligible', reasons=reasons or ['离线门槛通过，仅允许影子运行；正式晋级仍需3个真实成熟前瞻周期。'], rules=rules, wins=wins, testBlocks=len(tests)),
                samples=samples, registry=registry, skipped=data['skipped'], limitations=data['limitations']+['活动、价格与广告变量尚未接入；特征仅含滞后、滚动、日历与SKU/渠道属性。','联合残差路径是经验情景，不是经检验的缺货概率。'])

if __name__ == '__main__':
    src, dest = map(Path, sys.argv[1:3]); data = json.loads(src.read_text())
    result = compute(data['dataset'], dest.parent, data.get('budgetSeconds', 180))
    dest.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False))

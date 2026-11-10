"""AutoGluon adapter in its own dependency environment, using frozen daily views.

No database credentials, foundation-model downloads or outer test labels enter fit.
The independent residual calibration in forecast_compute remains authoritative.
"""
import hashlib
import importlib.metadata
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path


def fit_windows(data, directory, budget_seconds):
    import pandas as pd
    from autogluon.timeseries import TimeSeriesDataFrame, TimeSeriesPredictor
    started = time.monotonic()
    result, models = {}, {}
    windows = [*data['windows'], data['current']]
    directory = Path(directory)
    for index, window in enumerate(windows):
        remaining = budget_seconds - (time.monotonic() - started)
        if remaining < 3:
            raise TimeoutError('AUTOGLUON_BUDGET')
        rows = [dict(item_id=s['id'], timestamp=d, target=y)
                for s in window['series'] for d, y in zip(window['dates'], s['values'])]
        frame = pd.DataFrame(rows)
        frame['timestamp'] = pd.to_datetime(frame['timestamp'])
        frame['weekday'] = frame.timestamp.dt.dayofweek.astype(float)
        frame['weekend'] = (frame.timestamp.dt.dayofweek >= 5).astype(float)
        train = TimeSeriesDataFrame.from_data_frame(frame)
        train.static_features = pd.DataFrame([
            dict(item_id=s['id'], sku=s['entityId'], channel=s['channelId']) for s in window['series']
        ]).set_index('item_id')
        folder = directory / ('current' if index == len(windows)-1 else f'fold-{index}')
        predictor = TimeSeriesPredictor(
            path=str(folder), target='target', prediction_length=data['horizonDays'], freq='D',
            eval_metric='WAPE', quantile_levels=[.1, .5, .9],
            known_covariates_names=['weekday', 'weekend'], verbosity=0,
        )
        # AutoML candidates are explicitly bounded; no pretrained/network models.
        predictor.fit(
            train, time_limit=max(3, remaining/(len(windows)-index)),
            hyperparameters={
                'SeasonalNaive': {'seasonal_period': 7, 'n_jobs': 1},
                'RecursiveTabular': {'lags': [1, 7, 14, 28], 'differences': [],
                    'model_name': 'GBM', 'model_hyperparameters': {'num_boost_round': 100, 'num_threads': 1},
                    'max_num_samples': 10000},
                'DirectTabular': {'model_name': 'GBM',
                    'model_hyperparameters': {'num_boost_round': 100, 'num_threads': 1},
                    'max_num_samples': 10000},
            }, enable_ensemble=True, num_val_windows=1, random_seed=0,
        )
        future = predictor.make_future_data_frame(train)
        future['weekday'] = future.timestamp.dt.dayofweek.astype(float)
        future['weekend'] = (future.timestamp.dt.dayofweek >= 5).astype(float)
        forecast = predictor.predict(train, known_covariates=future)
        expected_dates = [(date.fromisoformat(window['origin'])+timedelta(days=i+1)).isoformat()
                          for i in range(data['horizonDays'])]
        values = {}
        for s in window['series']:
            leaf = forecast.loc[s['id']].sort_index()
            if [d.date().isoformat() for d in leaf.index] != expected_dates:
                raise ValueError('AUTOGLUON_FORECAST_DATES')
            values[s['id']] = leaf['mean'].clip(lower=0).tolist()
        key = 'current' if index == len(windows)-1 else str(index)
        result[key] = values
        models[key] = {'selected': predictor.model_best, 'trained': predictor.model_names(),
                       'inputDays': 84, 'validationWindows': 1}
    return {'predictions': result, 'models': models,
            'dependencies': {p: importlib.metadata.version(p) for p in
                             ('autogluon.timeseries', 'autogluon.tabular', 'numpy', 'pandas', 'torch')},
            'codeHash': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


if __name__ == '__main__':
    source, destination, directory = map(Path, sys.argv[1:4])
    payload = json.loads(source.read_text())
    value = fit_windows(payload['dataset'], directory, payload['budgetSeconds'])
    destination.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))

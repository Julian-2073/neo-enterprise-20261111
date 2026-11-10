import copy
import json
import pickle
import pytest
from datetime import date, timedelta
pytest.importorskip('statsforecast')
pytest.importorskip('mlforecast')
from neo_agent import forecast_compute as compute

def dataset():
    start = date(2025, 1, 1); h = 7
    def window(end, role, labels=True):
        dates = [(start+timedelta(days=i)).isoformat() for i in range(end-83, end+1)]
        series = []
        for sku, channel, scale in [('tee', 'direct', 2), ('mug', 'platform', 1)]:
            y = lambda i: 20+scale*(i % 7)+((i*11) % 5)
            series.append(dict(id=json.dumps([sku, channel]), entityId=sku, channelId=channel, values=[y(i) for i in range(end-83, end+1)], actual=[y(i) for i in range(end+1, end+h+1)] if labels else []))
        return dict(role=role, origin=(start+timedelta(days=end)).isoformat(), dates=dates, series=series)
    windows = [window(83+i*h, 'selection' if i<2 else 'calibration' if i<5 else 'test') for i in range(11)]
    current = window(83+11*h, 'test', False)
    return dict(version=compute.VERSION, businessId='program-fixture', dataNature='demo', generationId='isolated-unit', target='paid_units', timezone='UTC', origin=current['origin'], dataCutoff='2026-10-08T00:00:00Z', horizonDays=h, domain='as_of', current=current, windows=windows, skipped=[], limitations=['SYNTHETIC_DEMO program fixture'])

def test_real_cpu_adapters_and_model_artifacts(tmp_path):
    d = dataset(); result = compute.compute(d, tmp_path, 180)
    assert all(m['status']=='completed' for m in result['models']), result['models']
    assert len(result['points'])==14
    assert all(p['value']>=0 for p in result['points'])
    assert result['registry']['dependencies']['statsforecast']=='2.1.1'
    assert (tmp_path/'models.zip').stat().st_size==result['registry']['modelArtifactBytes']
    assert result['interval']['calibrationBlocks']==3
    assert result['interval']['testBlocks']==6
    assert len(result['samples'])==32
    with open(tmp_path/'four_week_mean.pkl', 'rb') as f: saved=pickle.load(f)
    assert saved['window']==d['current']

def test_outer_labels_and_failures_cannot_choose_internal_winner(monkeypatch):
    d = dataset()
    def fake(model, w, h, artifact=None):
        value=22 if model=='four_week_mean' else 25
        return {s['id']:[value]*h for s in w['series']}
    monkeypatch.setattr(compute, 'adapter', fake)
    first=compute.compute(d)
    changed=copy.deepcopy(d)
    for w in changed['windows']:
        if w['role']=='test':
            for s in w['series']: s['actual']=[10000]*7
    second=compute.compute(changed)
    assert first['selectedModel']==second['selectedModel']
    assert first['points']==second['points']
    assert first['models'][0]['test']!=second['models'][0]['test']
    current_origin=d['current']['origin']
    def later_failure(model,w,h,artifact=None):
        if w['role']=='test' and w['origin']!=current_origin and model==first['selectedModel']: raise RuntimeError('test-only failure')
        return fake(model,w,h,artifact)
    monkeypatch.setattr(compute,'adapter',later_failure)
    failed=compute.compute(d)
    assert failed['selectedModel']==first['selectedModel']
    assert failed['promotion']['status']=='baseline_only'

def test_no_calibration_means_no_interval_or_probability(monkeypatch):
    d=dataset();d['windows']=[]
    monkeypatch.setattr(compute,'adapter',lambda m,w,h,artifact=None:{s['id']:[10]*h for s in w['series']})
    r=compute.compute(d)
    assert r['interval']['status']=='unavailable'
    assert r['interval']['coverage'] is None
    assert all(p['lower'] is None and p['upper'] is None for p in r['points'])
    assert r['samples']==[] and r['promotion']['status']=='baseline_only'

def test_invalid_matrix_does_not_become_success():
    d=dataset();d['current']['series'][0]['values'][0]=float('nan')
    with pytest.raises(ValueError,match='DATASET_SCHEMA'):compute.compute(d)

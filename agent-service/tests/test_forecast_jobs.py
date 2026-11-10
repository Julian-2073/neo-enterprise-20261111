import pytest
from fastapi import HTTPException
from neo_agent.forecast_jobs import ForecastQueue

def job():return dict(id='forecast-job-'+'a'*64,controlToken='b'*64,budgetSeconds=30,dataset=dict(businessId='isolated',dataNature='demo',generationId='g'))
def test_queue_idempotency_cancellation_fence_and_scope(tmp_path):
    q=ForecastQueue(tmp_path);q.initialize();body=job();q.submit(body);q.submit(body)
    with pytest.raises(HTTPException) as conflict:q.submit({**body,'budgetSeconds':60})
    assert conflict.value.status_code==409
    row=q.claim();assert row['id']==body['id']
    with pytest.raises(HTTPException) as denied:q.scoped(body['id'],'other','demo',body['controlToken'])
    assert denied.value.status_code==404
    q.cancel(body['id'],'isolated','demo',body['controlToken']);q.finish(row,'completed')
    assert q.scoped(body['id'],'isolated','demo',body['controlToken'])['status']=='cancelled'
def test_restart_marks_interrupted_work_failed_instead_of_publishing(tmp_path):
    q=ForecastQueue(tmp_path);q.initialize();q.submit(job());q.claim();q.initialize(recover=True)
    assert q.scoped(job()['id'],'isolated','demo',job()['controlToken'])['error']=='WORKER_INTERRUPTED'

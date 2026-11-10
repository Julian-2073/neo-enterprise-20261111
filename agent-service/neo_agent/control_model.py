"""Resolve encrypted middle-platform credentials in memory, never in queue payloads."""
import os
from urllib.parse import urlsplit
import httpx
from .execution import ExecutionError
from .ontology import expand_ontology

async def configure_control_model(delegate, job):
    ref=expand_ontology(job.get('envelope',{})).get('modelProfileRef')
    if not ref:
        return
    if ref.get('businessId')!=job['businessId'] or ref.get('dataNature')!=job['dataNature']:
        raise ExecutionError('模型配置范围不匹配','MODEL_SCOPE')
    base=os.getenv('NEO_CONTROL_URL','').rstrip('/')
    token=os.getenv('NEO_SERVICE_TOKEN','')
    url=urlsplit(base)
    if not token or url.scheme not in ('http','https') or not url.hostname or url.username or url.password:
        raise ExecutionError('中台模型服务地址或认证尚未配置','MODEL_CONFIG')
    if url.scheme=='http' and url.hostname not in ('127.0.0.1','localhost'):
        raise ExecutionError('中台模型服务需要 HTTPS','MODEL_CONFIG')
    ident=ref.get('id','')
    if not isinstance(ident,str) or not ident.startswith('model-') or '/' in ident:
        raise ExecutionError('模型配置引用无效','MODEL_CONFIG')
    try:
        async with httpx.AsyncClient(timeout=15,follow_redirects=False,trust_env=False) as client:
            r=await client.get(base+'/api/v1/ontology/control/resolve/'+ident,params={'businessId':job['businessId'],'dataNature':job['dataNature']},headers={'Authorization':'Bearer '+token})
        if r.status_code!=200:
            raise ExecutionError('无法读取指定模型配置，请检查中台服务或密钥存储','MODEL_CONFIG')
        config=r.json()
        if config.get('baseUrl') not in ('https://api.openai.com/v1','https://api.deepseek.com/v1','https://dashscope.aliyuncs.com/compatible-mode/v1') or not config.get('apiKey') or not config.get('model'):
            raise ExecutionError('中台模型配置不完整','MODEL_CONFIG')
        delegate.name=config['model'];delegate.key=config['apiKey'];delegate.base=config['baseUrl']
    except (httpx.HTTPError,ValueError,KeyError) as e:
        raise ExecutionError('中台模型服务暂不可连接','MODEL_CONFIG') from e

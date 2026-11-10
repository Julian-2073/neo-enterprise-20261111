"""Authenticated adapters: OpenMetadata catalog and isolated OntoGPT process."""
import asyncio,hashlib,json,os,re,sys
from pathlib import Path
from urllib.parse import quote
import httpx
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,Field

router=APIRouter(prefix='/ontology-integrations')
ROOT=Path(__file__).resolve().parents[2]
PYTHON=ROOT/'integrations/ontogpt/.venv/bin/python'
SCRIPT=ROOT/'integrations/ontogpt/extract.py'
extract_lock=asyncio.Semaphore(1)
sync_lock=asyncio.Lock()

def om_url():return os.getenv('NEO_OPENMETADATA_URL','http://127.0.0.1:8585').rstrip('/')
def om_headers():return {'Authorization':'Bearer '+os.getenv('NEO_OPENMETADATA_TOKEN','')}

@router.get('/health')
async def health():
    om={'configured':bool(os.getenv('NEO_OPENMETADATA_TOKEN')),'connected':False,'url':om_url(),'version':None}
    models=[]
    async with httpx.AsyncClient(timeout=5,follow_redirects=False) as client:
        try:
            r=await client.get(om_url()+'/api/v1/system/version',headers=om_headers());identity=await client.get(om_url()+'/api/v1/users/loggedInUser',headers=om_headers());om['connected']=r.is_success and identity.is_success and om['configured'];om['version']=r.json().get('version') if r.is_success else None
        except (httpx.HTTPError,ValueError):pass
        try:
            r=await client.get('http://127.0.0.1:11434/api/tags');models=[m['name'] for m in r.json().get('models',[]) if isinstance(m.get('name'),str)] if r.is_success else []
        except (httpx.HTTPError,ValueError):pass
    return {'openmetadata':om,'ontogpt':{'installed':PYTHON.exists(),'version':'1.2.0' if PYTHON.exists() else None,'localModels':models}}

class CatalogInput(BaseModel):
    businessId:str=Field(min_length=1,max_length=120)
    dataNature:str=Field(pattern='^(demo|business)$')
    definition:dict

async def om_request(client,method,path,payload=None):
    try:r=await client.request(method,om_url()+'/api/v1/'+path,headers=om_headers(),json=payload)
    except httpx.HTTPError:raise HTTPException(502,'OpenMetadata 暂不可连接')
    if not r.is_success:raise HTTPException(502,f'OpenMetadata 请求失败（HTTP {r.status_code}），请检查连接与服务账号权限')
    return r.json()

def scope_name(business,nature):return 'neo_'+hashlib.sha256((business+'\0'+nature).encode()).hexdigest()[:20]

def validate_definition(d):
    types=d.get('types',[])
    if not types or len(types)>60:raise HTTPException(422,'对象定义数量无效')
    for t in types:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',t.get('id','')) or len(t.get('properties',{}))>100:raise HTTPException(422,'对象或属性标识无效')
        for p in t['properties']:
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',p):raise HTTPException(422,'属性标识无效')
    return types

@router.post('/openmetadata/sync')
async def sync(data:CatalogInput):
    if not os.getenv('NEO_OPENMETADATA_TOKEN'):raise HTTPException(503,'OpenMetadata 服务令牌尚未配置')
    types=validate_definition(data.definition);name=scope_name(data.businessId,data.dataNature)
    async with sync_lock,httpx.AsyncClient(timeout=30,follow_redirects=False) as client:
        await om_request(client,'PUT','services/databaseServices',{'name':name,'displayName':f'NEO · {data.businessId} · {data.dataNature}','serviceType':'CustomDatabase','description':'NEO published object definitions. Metadata only; no source rows or credentials.'})
        await om_request(client,'PUT','databases',{'name':'ontology','service':name,'description':f'NEO definition version: {data.definition["version"]}'})
        await om_request(client,'PUT','databaseSchemas',{'name':'objects','database':name+'.ontology'})
        glossary=await om_request(client,'PUT','glossaries',{'name':name,'displayName':f'NEO业务对象 · {data.businessId} · {data.dataNature}','description':'NEO企业对象术语与语义关系；语义关联不代表数据加工血缘。'})
        table_ids={};terms={};records=[]
        for t in types:
            columns=[{'name':p,'displayName':p,'dataType':{'integer':'BIGINT','number':'DOUBLE','boolean':'BOOLEAN','datetime':'TIMESTAMP','date':'DATE','object':'JSON','array':'JSON'}.get(prop['type'],'STRING'),'description':f'{"Required" if prop.get("required") else "Optional"}; NEO type: {prop["type"]}'} for p,prop in t['properties'].items()]
            table=await om_request(client,'PUT','tables',{'name':t['id'],'displayName':t['name'],'databaseSchema':name+'.ontology.objects','description':f'NEO published object definition {data.definition["version"]}; primary key: {t["primaryKey"]}. Definition only, not materialized records.','columns':columns})
            table_ids[t['id']]=table['id'];records.append({'id':table['id'],'typeId':t['id'],'fqn':table['fullyQualifiedName'],'url':om_url()+'/table/'+quote(table['fullyQualifiedName'],safe='')})
            terms[t['id']]=await om_request(client,'PUT','glossaryTerms',{'name':t['id'],'displayName':t['name'],'glossary':name,'description':f'{t["name"]}。NEO 对象 {t["id"]}，主键 {t["primaryKey"]}。'})
        relation_count=0
        for t in types:
            links=[l for l in data.definition.get('links',[]) if l.get('from')==t['id'] and l.get('to') in terms]
            if not links:continue
            related=list(dict.fromkeys(l['to'] for l in links))
            await om_request(client,'PUT','glossaryTerms',{'name':t['id'],'displayName':t['name'],'glossary':name,'description':f'{t["name"]}。NEO 对象 {t["id"]}，主键 {t["primaryKey"]}。\n'+'\n'.join(f'{l["name"]}: {l["from"]} → {l["to"]}' for l in links),'relatedTerms':[terms[k]['fullyQualifiedName'] for k in related]})
            relation_count+=len(links)
        # Verify actual remote schema+terms rather than trust PUT responses.
        for record in records:
            saved=await om_request(client,'GET','tables/'+record['id'])
            if saved.get('fullyQualifiedName')!=record['fqn']:raise HTTPException(502,'OpenMetadata 回读不一致')
        remote_terms=await om_request(client,'GET','glossaryTerms?glossary='+glossary['id']+'&limit=100')
        if not {t['id'] for t in terms.values()}.issubset({t['id'] for t in remote_terms.get('data',[])}):raise HTTPException(502,'OpenMetadata 术语回读不一致')
    return {'scope':name,'definitionId':data.definition['version'],'tables':records,'termCount':len(terms),'relationCount':relation_count,'status':'readback_verified','notice':'同步对象定义和语义关联；不上传原始经营行，不将语义关系标为加工血缘。'}

class ExtractInput(BaseModel):
    text:str=Field(min_length=1,max_length=8000)
    target:dict
    model:str=Field(max_length=150)
    baseUrl:str=Field(max_length=200)
    apiKey:str=Field(default='',max_length=4096)

@router.post('/ontogpt/extract')
async def extract(data:ExtractInput):
    if not PYTHON.exists():raise HTTPException(503,'OntoGPT 独立环境尚未安装')
    validate_definition({'types':[data.target]})
    allowed={'http://127.0.0.1:11434','https://api.openai.com/v1','https://api.deepseek.com/v1','https://dashscope.aliyuncs.com/compatible-mode/v1'}
    if data.baseUrl not in allowed:raise HTTPException(422,'不支持的模型服务地址')
    if not data.model.startswith(('ollama/','openai/')):raise HTTPException(422,'模型提供方无效')
    async with extract_lock:
        process=await asyncio.create_subprocess_exec(str(PYTHON),str(SCRIPT),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,cwd=str(ROOT),env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','LANG','SSL_CERT_FILE')})
        try:stdout,_=await asyncio.wait_for(process.communicate(data.model_dump_json().encode()),180)
        except (asyncio.TimeoutError,asyncio.CancelledError):
            process.kill();await process.wait();raise HTTPException(504,'OntoGPT 抽取超时，未修改数据')
    try:
        if process.returncode or len(stdout)>1024*1024:raise ValueError()
        result=json.loads(stdout.decode().strip().splitlines()[-1]);objects=result['objects']
        if not isinstance(objects,list) or len(objects)>100:raise ValueError()
        checked=[]
        for obj in objects:
            if not isinstance(obj,dict) or set(obj)-set(data.target['properties'])-{'source_quote'}:raise ValueError()
            if any(v is not None and (not isinstance(v,str) or len(v)>8000) for v in obj.values()):raise ValueError()
            obj.pop('source_quote',None);evidence=[];unsupported=[]
            for p,v in obj.items():
                if not v:continue
                at=data.text.find(v)
                if at<0:unsupported.append(p)
                else:evidence.append({'field':p,'sourceQuote':data.text[max(0,at-40):min(len(data.text),at+len(v)+40)]})
            quote_text=evidence[0]['sourceQuote'] if evidence else '';matched=bool(evidence)
            missing=[p for p,prop in data.target['properties'].items() if prop.get('required') and not obj.get(p)]
            checked.append({'properties':obj,'sourceQuote':quote_text,'sourceMatched':matched,'unsupportedFields':unsupported,'missingRequired':missing,'fieldEvidence':evidence,'status':'awaiting_review'})
        return {**result,'objects':checked,'sourceHash':hashlib.sha256(data.text.encode()).hexdigest(),'status':'awaiting_review','notice':'模型候选结果，字段类型、业务主键和来源依据仍需确认；未导入或修改对象。'}
    except (ValueError,KeyError,TypeError):raise HTTPException(502,'OntoGPT 未返回有效候选对象，未修改数据')

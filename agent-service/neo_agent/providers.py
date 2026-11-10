import asyncio, os, json, ipaddress, socket, hashlib, re, sqlite3, time
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
import httpx
from bs4 import BeautifulSoup
from .model_output import deepseek_messages, response_message

class ProviderError(RuntimeError): pass

def source_text(content):
    text=re.sub(r'!\[[^\]]*\]\([^)]*\)','',content)
    text=re.sub(r'\[([^\]]*)\]\([^)]*\)',r'\1',text)
    return re.sub(r'\s+',' ',text).strip()

def source_readable(content,title='',status=200):
    return int(status or 200)<400 and len(source_text(content))>=200 and not re.fullmatch(r'(?:40[0-9]|50[0-9]|access denied|forbidden)',title.strip(),re.I)

class Model:
    def __init__(self):
        self.key=os.getenv('LLM_API_KEY',''); self.name=os.getenv('LLM_MODEL',''); self.base=os.getenv('LLM_BASE_URL','https://api.openai.com/v1').rstrip('/')
    async def call(self,messages,tools=None):
        if not self.key or not self.name: raise ProviderError('模型未配置：请在服务端配置 LLM_MODEL 和 LLM_API_KEY')
        payload={'model':self.name,'messages':messages}
        if urlsplit(self.base).hostname=='api.deepseek.com':
            payload['messages']=deepseek_messages(messages)
            payload['thinking']={'type':'disabled' if tools else 'enabled'}
        if tools: payload.update(tools=tools,tool_choice='auto')
        else: payload['response_format']={'type':'json_object'}
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(90,connect=15),trust_env=False) as client:
                    r=await client.post(self.base+'/chat/completions',headers={'Authorization':'Bearer '+self.key},json=payload)
                    if r.status_code in (429,502,503,504) and attempt==0:
                        await asyncio.sleep(1);continue
                    if r.status_code>=400:raise ProviderError(f'模型请求失败（HTTP {r.status_code}），请检查模型配置或服务额度')
                    data=r.json()
                    return response_message(data)
            except httpx.HTTPError as e:
                if attempt==0:await asyncio.sleep(1);continue
                raise ProviderError('模型网络连接失败或超时，请稍后恢复调查') from e
            except (KeyError,ValueError,IndexError) as e:raise ProviderError('模型响应格式不正确') from e

async def public_url(url):
    p=urlsplit(url)
    if p.scheme not in ('https','http') or not p.hostname or p.username or p.password or p.port not in (None,80,443): raise ProviderError('来源 URL 不符合公开网页要求')
    addresses=await asyncio.get_running_loop().getaddrinfo(p.hostname,p.port or (443 if p.scheme=='https' else 80),type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses): raise ProviderError('不读取本地或私有网络地址')
    return url

async def fetch_source(url):
    # Resolve every redirect; do not forward credentials or permit private-network targets.
    async with httpx.AsyncClient(timeout=15,follow_redirects=False,trust_env=False) as client:
        for _ in range(4):
            await public_url(url)
            async with client.stream('GET',url,headers={'User-Agent':'NEO-Research/1.0'}) as r:
                if r.is_redirect:
                    url=str(r.url.join(r.headers['location']));continue
                if r.status_code!=200: raise ProviderError(f'原始来源不可读取（HTTP {r.status_code}）')
                if 'html' not in r.headers.get('content-type','') and 'text/plain' not in r.headers.get('content-type',''): raise ProviderError('首版仅读取公开文本网页')
                data=bytearray()
                async for chunk in r.aiter_bytes():
                    data.extend(chunk)
                    if len(data)>1000000: raise ProviderError('原始网页超过读取上限')
            soup=BeautifulSoup(bytes(data),'html.parser')
            for item in soup(['script','style','nav','footer']):item.decompose()
            publication=None
            tag=soup.find('meta',property='article:published_time') or soup.find('meta',attrs={'name':'date'})
            if tag: publication=tag.get('content')
            content=' '.join(soup.stripped_strings)[:12000]
            return {'url':url,'publishedAt':publication,'content':content,'contentHash':hashlib.sha256(bytes(data)).hexdigest()}
        raise ProviderError('原始来源重定向过多')

class Market:
    def __init__(self):
        self.key=os.getenv('TAVILY_API_KEY','')
        self.provider=os.getenv('NEO_MARKET_PROVIDER','tavily')
        self.command=os.getenv('NEO_FIRECRAWL_MCP_COMMAND','')
        self.cache=Path(os.getenv('NEO_MARKET_CACHE',str(Path(__file__).parent.parent/'state/market-cache.sqlite')))
    def cached(self,key,value=None):
        self.cache.parent.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(self.cache) as db:
            db.execute('CREATE TABLE IF NOT EXISTS sources(key TEXT PRIMARY KEY,payload TEXT,expires REAL)')
            if value is not None:
                db.execute('INSERT OR REPLACE INTO sources VALUES(?,?,?)',(key,json.dumps(value,ensure_ascii=False),time.time()+86400));return value
            row=db.execute('SELECT payload FROM sources WHERE key=? AND expires>?',(key,time.time())).fetchone()
            return json.loads(row[0]) if row else None
    async def search(self,query,as_of):
        cache_key=hashlib.sha256((self.provider+':source-check-v2:'+query.strip()).encode()).hexdigest()
        cached=self.cached(cache_key)
        if cached is not None:return cached
        if self.provider=='firecrawl_mcp':return await self.search_firecrawl(query,cache_key)
        if not self.key:raise ProviderError('真实市场检索未配置：缺少 TAVILY_API_KEY')
        async with httpx.AsyncClient(timeout=30) as client:
            r=await client.post('https://api.tavily.com/search',json={'api_key':self.key,'query':query,'search_depth':'basic','max_results':5,'include_answer':False})
            if r.status_code>=400:raise ProviderError(f'市场检索失败（HTTP {r.status_code}）')
            hits=r.json().get('results',[])
        records=[]
        for hit in hits[:5]:
            now=datetime.now(timezone.utc).isoformat(); url=hit['url']
            record={'id':'market-'+hashlib.sha256((url+now[:10]).encode()).hexdigest()[:24],'url':url,'title':hit.get('title',''),'retrievedAt':now,'publishedAt':None,'verificationStatus':'unavailable','historicalEligible':False,'limitations':['当前抓取不能证明网页在历史时点的内容；不用于解释历史模拟经营原因。']}
            try:
                fetched=await fetch_source(url)
                record.update(fetched);record['verificationStatus']='source_read';record['excerpt']=fetched['content'][:1500]
                # Even an old publication date is not proof of historical page contents.
            except (ProviderError,httpx.HTTPError,OSError) as e:record['error']=str(e)[:200]
            records.append(record)
        if records and all(r['verificationStatus']=='source_read' for r in records):self.cached(cache_key,records)
        return records

    async def search_firecrawl(self,query,cache_key):
        from .mcp import FirecrawlMCP
        records=[]
        async with FirecrawlMCP(self.command) as client:
            result=await client.call('firecrawl_search',{'query':query,'limit':3,'sources':['web'],'domainTools':False})
            if result.get('success') is False:raise ProviderError('Firecrawl 检索未成功')
            data=result.get('data',{});hits=data.get('web',[]) if isinstance(data,dict) else data
            for hit in (hits or [])[:3]:
                url=hit.get('url','');now=datetime.now(timezone.utc).isoformat()
                record={'id':'market-'+hashlib.sha256((url+now[:10]).encode()).hexdigest()[:24],'url':url,'title':hit.get('title',''),'retrievedAt':now,'publishedAt':None,'verificationStatus':'unavailable','historicalEligible':False,'provider':'firecrawl_mcp','query':query,'limitations':['Firecrawl 当前检索；不能证明历史时点网页内容，不解释模拟历史经营原因。']}
                try:
                    await public_url(url)
                    doc=await client.call('firecrawl_scrape',{'url':url,'formats':['markdown'],'onlyMainContent':True,'maxAge':0})
                    if doc.get('success') is False:raise ProviderError('Firecrawl 原文读取未成功')
                    page=doc.get('data',doc);content=page.get('markdown','');meta=page.get('metadata',{}) or {}
                    if not source_readable(content,meta.get('title') or hit.get('title',''),meta.get('statusCode',200)):raise ProviderError('Firecrawl 来源为错误页或正文不足')
                    record.update(title=meta.get('title') or record['title'],publishedAt=meta.get('publishedTime') or meta.get('publishedDate') or meta.get('article:published_time'),content=content[:12000],excerpt=source_text(content)[:1500],contentHash=hashlib.sha256(content.encode()).hexdigest(),verificationStatus='source_read')
                except (ProviderError,OSError,ValueError):record['error']='原始来源暂不可读取；不作为已核实证据'
                records.append(record)
        if records and all(r['verificationStatus']=='source_read' for r in records):self.cached(cache_key,records)
        return records

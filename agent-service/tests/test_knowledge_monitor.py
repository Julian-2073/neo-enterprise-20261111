import json,asyncio
import pytest
from neo_agent.job_queue import JobQueue,stamp
from neo_agent.execution import JournaledModel,ExecutionError
from neo_agent.engine import source_hash
from neo_agent.knowledge_monitor import validate_extraction,KnowledgeRuntime

def job(ident='knowledge-1'):
 return {'id':ident,'businessId':'a','dataNature':'demo','purpose':'knowledge','taskType':'DOCUMENT','document':{'id':'d','version':'hash','sourceId':'s','sourceVersion':1,'originalId':'o','publishedAt':'2026-10-01','retrievedAt':'2026-10-08T01:00:00Z','paragraphs':[{'index':0,'text':'本规则自2027年10月1日起生效，仅适用于室内固定式健身器材。'}]},'configuration':{'version':1,'region':None,'objectives':[],'constraints':[]},'scope':{'operatingVersion':'v1','entities':[]}}
def extraction():
 return {'claims':[{'statement':'本规则适用于室内固定式健身器材。','paragraphIndices':[0],'region':'全国','effectiveAt':'2027-10-01','expiresAt':None,'limitations':['需核实产品范围'],'applicability':'unknown','relations':[],'impact':'待核实','urgency':'normal','deadline':None,'actionability':'research','classification':'affects_assessment','reason':'安全规则改变','entities':[]} ]}
def test_unknown_applicability_future_rule_cannot_trigger_or_emergency():
 v=validate_extraction(extraction(),job());assert v['claims'][0]['classification']=='research';assert not v['claims'][0]['emergencyEligible'];assert v['claims'][0]['temporalUse']=='future_planning'
@pytest.mark.parametrize('change',[{'paragraphIndices':[9]},{'effectiveAt':'not-date'},{'relations':['invented']},{'statement':'今年规则导致去年销量下降。'}])
def test_bad_reference_date_relation_or_causality_rejected(change):
 v=extraction();v['claims'][0].update(change)
 with pytest.raises((ValueError,ExecutionError)):validate_extraction(v,job())
def test_background_calls_continue_after_old_daily_budget_without_losing_usage(tmp_path):
 q=JobQueue(tmp_path/'queue.sqlite');q.initialize();a=job();q.submit(a,source_hash(a));q.claim('owner',lane='background')
 other=job('spent');q.submit(other,source_hash(other))
 with q.db() as c:
  c.execute("INSERT INTO model_calls VALUES(?,?,'completed','fixture',NULL,?,NULL,?,?,?)",('spent','spent',json.dumps({'total_tokens':199990}),199990,stamp(),stamp()))
 class Model:
  name='fixture'
  async def call(self,*args):return {'content':'ok'},{'total_tokens':300000}
 asyncio.run(JournaledModel(q,a['id'],Model(),'owner').call([{'role':'user','content':'extract'}]))
 assert q.observe(a['id'])['observability']['reportedTokens']==300000
 with q.db() as c:assert c.execute('SELECT count(*) FROM model_calls').fetchone()[0]==2

def test_numeric_query_freezes_but_does_not_present_policy_pack_or_memory():
 from neo_agent.current_knowledge import read_knowledge
 env={'snapshot':{'businessId':'a','dataNature':'demo'},'knowledge':{'businessId':'a','dataNature':'demo','version':'v1','capturedAt':'2026-10-08','items':[],'rules':[],'pack':{'id':'pack:ecommerce','version':'v1'}}}
 out=read_knowledge(env,'查询支付订单笔数和退款订单笔数');assert out['pack'] is None;assert out['items']==[]
 assert read_knowledge(env,'哪些规则影响履约')['pack']['id']=='pack:ecommerce'
 env['knowledge']['businessId']='b'
 with pytest.raises(ValueError,match='范围不一致'):read_knowledge(env,'读取政策')

def test_knowledge_shared_catalog_has_exact_paragraph_versions_and_only_used_dependencies():
 from neo_agent.current_knowledge import knowledge_catalog,knowledge_versions
 k={'items':[{'id':'c','version':'cv','documentId':'d','documentVersion':'dv','sourceId':'s','publishedAt':None,'retrievedAt':'2026-10-08','url':'https://www.samr.gov.cn','paragraphs':[{'index':2,'text':'完整原段落','start':4,'end':9}]}]}
 catalog=knowledge_catalog(k);r=catalog['d:paragraph:2'];assert r['exact']=='完整原段落';assert r['documentVersion']=='dv'
 assert knowledge_versions([])==[]
 versions=knowledge_versions([{'supportingReferences':[r]}]);assert {v['id'] for v in versions}=={'c','d'}

def test_shared_worker_extracts_and_semantically_quarantines_unsupported_applicability(tmp_path):
 from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
 from neo_agent.runner import run_once
 q=JobQueue(tmp_path/'queue.sqlite');q.initialize();j=job();q.submit(j,source_hash(j))
 class Scripted:
  name='offline-document-fixture'
  async def call(self,messages,tools=None):
   if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
    assert 'json' in messages[0]['content'].lower(), 'json_object provider mode requires explicit JSON instruction'
    return {'content':json.dumps({'claims':[{'i':i,'s':'S' if i==0 else 'I','r':[0] if i==0 else [],'c':[],'g':[] if i==0 else ['需核对']} for i in range(4)]})},{'total_tokens':100,'prompt_tokens':50,'completion_tokens':50}
   return {'content':json.dumps(extraction(),ensure_ascii=False)},{'total_tokens':100,'prompt_tokens':50,'completion_tokens':50}
 async def execute():
  async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
   assert await run_once(q,'worker',saver,model_factory=Scripted,lane='background')
 asyncio.run(execute());r=q.observe(j['id']);assert r['status']=='completed',r['error'];assert r['result']['claims'][0]['classification']=='research';assert r['result']['claims'][0]['supportStatus']=='insufficient';assert r['observability']['modelInvocations']==2
 # Replayed completed job remains inert after process recovery.
 q.initialize();assert q.recover()==0;assert q.claim('another',lane='background') is None

def test_deferred_daily_budget_waits_until_next_day_without_spinning(tmp_path):
 q=JobQueue(tmp_path/'queue.sqlite');q.initialize();j=job();q.submit(j,source_hash(j));q.claim('owner',lane='background');q.finish(j['id'],'owner','deferred',code='BACKGROUND_DAILY_BUDGET',retryable=True)
 assert q.observe(j['id'])['status']=='deferred';q.recover();assert q.claim('worker',lane='background') is None
 q.recover('2099-01-01T01:00:00+00:00');assert q.claim('worker',lane='background')['id']==j['id']

@pytest.mark.parametrize('business,nature,state,allowed',[
 ('b','demo','completed',True),('a','business','completed',False),('a','demo','uncertain',False),('a','demo','started',False)])
def test_other_business_or_background_usage_does_not_block_current_task(tmp_path,business,nature,state,allowed):
 q=JobQueue(tmp_path/'queue.sqlite');q.initialize();a=job();q.submit(a,source_hash(a));q.claim('owner',lane='background')
 other={**job('other'), 'businessId':business,'dataNature':nature};q.submit(other,source_hash(other))
 with q.db() as c:c.execute('INSERT INTO model_calls VALUES(?,?,?,?,NULL,?,NULL,?,?,?)',('other','spent',state,'fixture',json.dumps({'total_tokens':199990}),199990,stamp(),stamp()))
 class Model:
  name='fixture';calls=0
  async def call(self,*args):self.calls+=1;return {'content':'{}'},{'total_tokens':10}
 model=Model()
 asyncio.run(JournaledModel(q,a['id'],model,'owner').call([{'role':'user','content':'extract'}]));assert model.calls==1
 assert q.observe(a['id'])['observability']['reportedTokens']==10

def test_shared_paragraph_preserves_separate_claims_versions_and_applicability():
 from neo_agent.current_knowledge import knowledge_catalog,knowledge_versions
 common={'documentId':'d','documentVersion':'dv','sourceId':'s','sourceVersion':'1','publishedAt':None,'retrievedAt':'2026-10-08','url':'https://www.samr.gov.cn','paragraphs':[{'index':0,'text':'同段不同适用条件','start':0,'end':8}]}
 value={'items':[{**common,'id':'a','version':'av','statement':'甲条件适用','applicabilityVerified':True,'effectiveAt':'2026-10-01'},{**common,'id':'b','version':'bv','statement':'乙条件待核','applicabilityVerified':False,'effectiveAt':'2027-01-01'}]}
 refs=knowledge_catalog(value);p=refs['d:paragraph:0']
 assert 'knowledgeId' not in p;assert not p.get('applicabilityVerified');assert len(p['claims'])==2
 assert refs['a']['applicabilityVerified'] is True;assert refs['b']['applicabilityVerified'] is False
 assert refs['a']['effectiveAt']!=refs['b']['effectiveAt']
 assert {v['id'] for v in knowledge_versions([{'supportingReferences':[p]}])}=={'a','b','d','s'}
 assert {v['id'] for v in knowledge_versions([{'supportingReferences':[refs['a']]}])}=={'a','d','s'}
 assert knowledge_catalog({'items':list(reversed(value['items']))})==refs

@pytest.mark.parametrize('redirect',[301,302,303,307,308])
def test_pinned_source_read_preserves_https_identity_and_rejects_redirects(monkeypatch,redirect):
 from neo_agent.source_fetch import fetch_knowledge_source
 import httpx,socket
 calls=[]
 async def resolve(host,port,**kwargs):
  calls.append(host)
  return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34' if len(calls)==1 else '127.0.0.1',port))]
 seen=[]
 def handle(request):
  seen.append(request);return httpx.Response(redirect,headers={'location':'https://private.example/secret'})
 async def execute():
  with pytest.raises(ValueError,match='重定向'):await fetch_knowledge_source('https://public.example/path',['public.example'],resolver=resolve,transport=httpx.MockTransport(handle))
 asyncio.run(execute());assert calls==['public.example'];assert len(seen)==1
 assert seen[0].url.host=='93.184.216.34';assert seen[0].headers['host']=='public.example';assert seen[0].extensions['sni_hostname']=='public.example'

def test_pinned_source_rejects_any_private_resolution_before_connection():
 from neo_agent.source_fetch import fetch_knowledge_source
 import httpx,socket
 async def resolve(*args,**kwargs):return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443)),(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',443))]
 def forbidden(request):raise AssertionError('private DNS must be rejected before dispatch')
 with pytest.raises(ValueError,match='私有'):asyncio.run(fetch_knowledge_source('https://public.example/path',['public.example'],resolver=resolve,transport=httpx.MockTransport(forbidden)))

@pytest.mark.parametrize('deadline,expected',[('2026-10-08T08:00:00+08:00',True),('2026-10-08T10:00:00+08:00',False),('2026-10-08',False)])
def test_shanghai_midnight_effective_date_and_next_daily_emergency(deadline,expected):
 j=job();j['document']['retrievedAt']='2026-10-07T18:30:00Z';j['scope']['entities']=['sku'];j['configuration']={'region':'浙江','objectives':[],'constraints':[{'id':'rule','version':'1','kind':'fulfillment','deadline':deadline}]}
 v=extraction();v['claims'][0].update(effectiveAt='2026-10-08',applicability='applicable',relations=['rule'],entities=['sku'],deadline=deadline,urgency='urgent')
 claim=validate_extraction(v,j)['claims'][0];assert claim['temporalUse']=='current_external_observation';assert claim['emergencyEligible'] is expected
 if 'T' not in deadline:assert 'deadline_time_unknown_no_precise_emergency' in claim['gaps']

def test_model_can_query_older_active_policy_and_page_frozen_knowledge():
 from neo_agent.current_knowledge import read_knowledge
 items=[{'id':str(i),'state':'active','supportStatus':'supported','statement':'一般政策'} for i in range(45)];items[44]['statement']='古老但有效的特殊器材规则'
 env={'snapshot':{'businessId':'a','dataNature':'demo'},'knowledge':{'businessId':'a','dataNature':'demo','capturedAt':'2026-10-08T00:00:00Z','items':items,'coverage':{'complete':True,'totalActiveClaims':45}}}
 out=read_knowledge(env,'特殊器材规则');assert out['items'][0]['id']=='44';assert out['coverage']['complete']
 paged=read_knowledge(env,'',limit=6,cursor=42);assert len(paged['items'])==3;assert paged['page']['nextCursor'] is None

def test_ip_transport_connects_vetted_address_and_verifies_original_tls_identity():
 from neo_agent.source_fetch import fetch_knowledge_source
 import httpx,socket,ssl
 connected=[];tls=[];written=[];lookups=[]
 async def resolve(host,port,**kwargs):
  lookups.append(host);return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34' if len(lookups)==1 else '127.0.0.1',port))]
 class Stream:
  response=b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: close\r\n\r\npolicy'
  async def read(self,*args,**kwargs):result=self.response;self.response=b'';return result
  async def write(self,buffer,**kwargs):written.append(buffer)
  async def aclose(self):pass
  def get_extra_info(self,info):return None
  async def start_tls(self,ssl_context,server_hostname,**kwargs):
   tls.append(server_hostname);assert ssl_context.check_hostname is True;assert ssl_context.verify_mode==ssl.CERT_REQUIRED;return self
 class Backend:
  async def connect_tcp(self,host,port,**kwargs):connected.append((host,port));return Stream()
 transport=httpx.AsyncHTTPTransport(retries=0)
 # Test-only backend replaces the actual socket. Production uses stock httpx
 # transport with a literal IP and no custom TLS verification bypass.
 transport._pool._network_backend=Backend()
 result=asyncio.run(fetch_knowledge_source('https://public.example/path',['public.example'],resolver=resolve,transport=transport))
 assert result['body']=='policy';assert connected==[('93.184.216.34',443)];assert tls==['public.example'];assert lookups==['public.example'];assert b'Host: public.example' in b''.join(written)

def test_completed_full_review_in_other_nature_blocks_second_full(tmp_path):
 q=JobQueue(tmp_path/'queue.sqlite');q.initialize();a={**job(),'envelope':{'monitorReview':{'kind':'full'}}};q.submit(a,source_hash(a));q.claim('owner',lane='background')
 other={**job('prior-full'),'dataNature':'business','envelope':{'monitorReview':{'kind':'full'}}};q.submit(other,source_hash(other))
 with q.db() as c:c.execute("UPDATE jobs SET status='completed',finished_at=? WHERE id='prior-full'",(stamp(),))
 class Model:
  name='fixture'
  async def call(self,*args):raise AssertionError('duplicate enterprise full must not dispatch')
 with pytest.raises(ExecutionError) as e:asyncio.run(JournaledModel(q,a['id'],Model(),'owner').call([{'role':'user','content':'extract'}]))
 assert e.value.code=='MONITOR_DAILY_LIMIT'

def test_catalog_merges_different_query_pages_without_overwriting_shared_paragraph():
 from neo_agent.current_knowledge import merge_knowledge_catalog,knowledge_versions
 from neo_agent.scoped_queries import model_basis
 from neo_agent.agent import TOOL_SPECS
 common={'documentId':'d','documentVersion':'dv','sourceId':'s','sourceVersion':'1','publishedAt':None,'retrievedAt':'2026-10-08','url':'https://www.samr.gov.cn','paragraphs':[{'index':0,'text':'同段原文','start':0,'end':4}]}
 refs={}
 for ident in ['a','b']:merge_knowledge_catalog(refs,{'items':[{**common,'id':ident,'version':ident+'v','statement':ident}]})
 assert {v['id'] for v in knowledge_versions([{'supportingReferences':[refs['d:paragraph:0']]}])}=={'a','b','d','s'}
 assert 'knowledge' not in model_basis({'knowledge':{'items':['must not enter whole prompt']}})
 assert 'knowledgeQuery' in next(t for t in TOOL_SPECS if t['function']['name']=='describe_business')['function']['parameters']['properties']

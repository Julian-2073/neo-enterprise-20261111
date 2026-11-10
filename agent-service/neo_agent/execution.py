"""Run-scoped model response journal and tool observations.

The production adapter makes exactly one HTTP attempt. A lost response is not
safe to retry, even when LangGraph can resume the surrounding node.
"""
import asyncio
import json
import re
from urllib.parse import urlsplit
import httpx
from .engine import source_hash
from .providers import Model, ProviderError
from .job_queue import stamp, usage_tokens
from .model_output import deepseek_messages, response_message
from .task_plan import unlimited_limits


def input_profile(messages):
    """Identify unchanged message prefixes without persisting another transcript."""
    return [{'hash':source_hash(message),
             'bytes':len(json.dumps(message,ensure_ascii=False).encode())}
            for message in messages]


def reserve_input(messages, tools, completed):
    """Use provider-reported prefix usage; bound only the new content by bytes.

    Tokenizers differ between providers, so no characters-per-token ratio is
    assumed. A completed call reports tokens for its entire input, including
    its old tools. Reuse that count only for an exactly unchanged message
    prefix on the same model. Count the entire new tool schema again and allow
    extra framing/boundary overhead. Without trustworthy usage/profile, retain
    the original full UTF-8 upper bound. This is a reservation, not billed usage.
    """
    profile=input_profile(messages)
    full=len(json.dumps({'messages':messages,'tools':tools},ensure_ascii=False).encode())+256
    best=full;basis={'method':'utf8_upper_bound'}
    tools_bytes=len(json.dumps(tools,ensure_ascii=False).encode())
    for previous,usage in completed:
        tokens=usage.get('prompt_tokens')
        if type(tokens) is not int or tokens<=0 or not previous:
            continue
        if len(previous)>len(profile) or previous!=profile[:len(previous)]:
            continue
        added=sum(row['bytes']+8 for row in profile[len(previous):])
        estimate=tokens+added+tools_bytes+256
        if estimate<best:
            best=estimate;basis={'method':'reported_prefix_plus_utf8_upper_bound',
                'prefixMessages':len(previous),'reportedPromptTokens':tokens,
                'addedMessageBytes':added,'toolSchemaBytes':tools_bytes}
    return best,profile,basis


class ExecutionError(ProviderError):
    def __init__(self, message, code, retryable=False):
        super().__init__(message)
        self.code, self.retryable = code, retryable


class ModelRejected(ExecutionError):
    """Known rejection before a usable model response; explicit resume only."""
    def __init__(self, message):
        super().__init__(message, 'MODEL_REJECTED', True)


def rejection_message(response, credential):
    """Preserve a bounded, redacted provider reason instead of guessing from HTTP."""
    try:
        body=response.json()
        detail=body.get('error') if isinstance(body,dict) else None
        detail=detail if isinstance(detail,dict) else {'message':detail} if isinstance(detail,str) else {}
    except ValueError:detail={}
    parts=[]
    for field in ('code','message'):
        text=detail.get(field)
        if not isinstance(text,str):continue
        if credential:text=text.replace(credential,'[redacted]')
        text=re.sub(r'(?i)Bearer\s+\S+','Bearer [redacted]',text)
        text=re.sub(r'\bsk-[A-Za-z0-9_-]+','[redacted]',text)
        text=re.sub(r'(?i)(api[_ -]?key|authorization|access[_ -]?token)\s*[:=]\s*\S+',r'\1=[redacted]',text)
        text=re.sub(r'\s+',' ',text).strip()[:180]
        if text:parts.append(text)
    reason='；供应商原因：'+' / '.join(parts) if parts else '；供应商未提供可识别的拒绝原因'
    return f'模型请求被拒绝（HTTP {response.status_code}）'+reason+'；核对当前模型路由与账户凭证后显式恢复'


class SingleAttemptModel(Model):
    def __init__(self, completion_tokens=None, *, response_timeout_seconds=180):
        super().__init__()
        self.completion_tokens = completion_tokens
        self.response_timeout_seconds = response_timeout_seconds

    async def call(self, messages, tools=None):
        if not self.key or not self.name:
            raise ModelRejected('模型未配置：请在服务端配置 LLM_MODEL 和 LLM_API_KEY')
        payload = {'model':self.name,'messages':messages}
        if self.completion_tokens is not None:payload['max_tokens']=self.completion_tokens
        if urlsplit(self.base).hostname == 'api.deepseek.com':
            payload['messages'] = deepseek_messages(messages)
            semantic=not tools and messages and messages[0].get('role')=='system' and messages[0].get('content','').startswith('NEO_SEMANTIC_SUPPORT_CHECK')
            # Semantic support is a constrained evidence classification task.
            # Disabling thinking avoids provider-specific reasoning_content
            # replay requirements and prevents a second oversized reasoning
            # pass over the same frozen evidence. Generative synthesis keeps
            # deliberate reasoning; tool turns retain their non-thinking mode.
            payload['thinking'] = {'type':'disabled' if tools or semantic else 'enabled'}
        if tools:
            payload.update(tools=tools,tool_choice='auto')
        else:
            payload['response_format'] = {'type':'json_object'}
        try:
            # Read-idle timeouts reset on provider keep-alive blank lines. Bound
            # the full response as well, without retrying an ambiguous request.
            async with asyncio.timeout(self.response_timeout_seconds):
                # The configured model URL is the route; do not silently pick
                # up a desktop system proxy (which may be unavailable).
                async with httpx.AsyncClient(timeout=httpx.Timeout(90,connect=15),trust_env=False) as client:
                    response = await client.post(self.base+'/chat/completions',headers={'Authorization':'Bearer '+self.key},json=payload)
            if response.status_code in (400,401,402,403,404,413,422,429):
                raise ModelRejected(rejection_message(response,self.key))
            if response.status_code >= 400:
                raise ExecutionError(f'模型服务异常（HTTP {response.status_code}），完成与计费状态待核对', 'MODEL_CALL_UNCERTAIN')
            data = response.json()
            return response_message(data)
        except TimeoutError as e:
            raise ExecutionError(f'模型请求在{self.response_timeout_seconds:g}秒内未返回完整结果；完成与计费状态未知，已阻止自动重发', 'MODEL_CALL_UNCERTAIN') from e
        except httpx.HTTPError as e:
            raise ExecutionError('模型连接中断或超时；完成与计费状态未知，已阻止自动重发', 'MODEL_CALL_UNCERTAIN') from e
        except (ValueError,KeyError,IndexError) as e:
            raise ExecutionError('模型响应无法解析；可能已经计费，请核对后另建任务', 'MODEL_CALL_UNCERTAIN') from e


class JournaledModel:
    def __init__(self, queue, ident, delegate, owner=None):
        self.queue, self.ident, self.delegate = queue, ident, delegate
        self.name = getattr(delegate, 'name', 'test-adapter')
        with queue.db() as c:
            self.owner = owner or c.execute('SELECT lease_owner FROM jobs WHERE id=?',(ident,)).fetchone()['lease_owner']

    def blocks_call(self,messages,tools=None):
        key=source_hash({'model':self.name,'messages':messages,'tools':tools})
        with self.queue.db() as c:
            job=c.execute('SELECT payload FROM jobs WHERE id=?',(self.ident,)).fetchone()
            parent=json.loads(job['payload']).get('recoveryFrom') if job else None
            return bool(parent and c.execute("SELECT 1 FROM model_calls WHERE job_id=? AND call_key=? AND state IN ('started','uncertain')",(parent,key)).fetchone())

    async def call(self, messages, tools=None):
        if self.blocks_call(messages,tools):raise ExecutionError('原任务同一调用完成状态未知，禁止在新任务重发','MODEL_CALL_UNCERTAIN')
        key = source_hash({'model':self.name,'messages':messages,'tools':tools})
        with self.queue.db(immediate=True) as c:
            job = c.execute('SELECT * FROM jobs WHERE id=?',(self.ident,)).fetchone()
            if job['status'] != 'running' or job['lease_owner'] != self.owner:
                raise asyncio.CancelledError()
            limits = unlimited_limits(json.loads(job['limits_json']))
            if c.execute('SELECT 1 FROM model_calls WHERE job_id=? AND model!=? LIMIT 1',(self.ident,self.name)).fetchone():
                raise ExecutionError('本任务模型版本已改变；请另建任务，不能静默覆盖已有输入和调用记录', 'MODEL_VERSION_CHANGED')
            saved = c.execute('SELECT * FROM model_calls WHERE job_id=? AND call_key=?',(self.ident,key)).fetchone()
            if saved and saved['state'] == 'completed':
                self.queue.event(c,self.ident,'model_replayed',{'callKey':key})
                return json.loads(saved['response']),json.loads(saved['usage'] or '{}')
            if c.execute("SELECT 1 FROM model_calls WHERE job_id=? AND state IN ('started','uncertain')",(self.ident,)).fetchone():
                raise ExecutionError('已有模型调用完成或计费状态未知，禁止自动重发', 'MODEL_CALL_UNCERTAIN')
            models = c.execute('SELECT call_key,state,usage,reserved_tokens FROM model_calls WHERE job_id=?',(self.ident,)).fetchall()
            profiles={}
            for event in c.execute("SELECT payload FROM run_events WHERE job_id=? AND kind='model_started'",(self.ident,)):
                detail=json.loads(event['payload'])
                if detail.get('inputProfile'):profiles[detail['callKey']]=detail['inputProfile']
            completed=[(profiles.get(m['call_key']),json.loads(m['usage'] or '{}'))
                       for m in models if m['state']=='completed']
            input_reserve,profile,reservation_basis=reserve_input(messages,tools,completed)
            reserve=input_reserve+(limits['completionTokens'] or 0)
            payload=json.loads(job['payload'])
            if payload.get('purpose') in ('knowledge','patrol') or payload.get('envelope',{}).get('monitorReview'):
                from datetime import datetime,timedelta,timezone
                day=datetime.now(timezone(timedelta(hours=8))).date().isoformat()
                monitor=payload.get('envelope',{}).get('monitorReview',{})
                from .time_scope import aware_time
                if monitor.get('kind')=='emergency' and (aware_time(monitor['validUntil'])<=datetime.now(timezone.utc) if monitor.get('validUntil') else monitor.get('day')!=day):
                    raise ExecutionError('紧急复核窗口已过期；保留证据等待重新核对','EMERGENCY_WINDOW_EXPIRED')
                if monitor.get('kind')=='full' and c.execute("SELECT 1 FROM jobs WHERE id!=? AND status='completed' AND json_extract(payload,'$.businessId')=? AND json_extract(payload,'$.envelope.monitorReview.kind')='full' AND date(finished_at,'+8 hours')=? LIMIT 1",(self.ident,payload['businessId'],day)).fetchone():
                    raise ExecutionError('本企业当日已完成自动全面研判，后续变化延至次日','MONITOR_DAILY_LIMIT',True)
            c.execute("INSERT INTO model_calls VALUES(?,?,'started',?,NULL,NULL,NULL,?,?,NULL) ON CONFLICT(job_id,call_key) DO UPDATE SET state='started',error=NULL,started_at=excluded.started_at,finished_at=NULL,reserved_tokens=excluded.reserved_tokens",
                (self.ident,key,self.name,reserve,stamp()))
            self.queue.event(c,self.ident,'model_started',{'callKey':key,'reservedTokens':reserve,
                'inputProfile':profile,'reservationBasis':reservation_basis})
        try:
            message, usage = await self.delegate.call(messages, tools)
            with self.queue.db(immediate=True) as c:
                c.execute("UPDATE model_calls SET state='completed',response=?,usage=?,finished_at=? WHERE job_id=? AND call_key=?",(json.dumps(message,ensure_ascii=False),json.dumps(usage or {}),stamp(),self.ident,key))
                self.queue.event(c,self.ident,'model_completed',{'callKey':key,'usage':usage or {}})
            return message,usage
        except BaseException as e:
            # Cancellation, network loss and arbitrary adapter errors cannot
            # prove that the external provider did not charge this request.
            known = isinstance(e, ModelRejected)
            state = 'rejected' if known else 'uncertain'
            with self.queue.db(immediate=True) as c:
                c.execute('UPDATE model_calls SET state=?,error=?,finished_at=? WHERE job_id=? AND call_key=? AND state!=\'completed\'',(state,str(e)[:500] or '调用被中断',stamp(),self.ident,key))
                self.queue.event(c,self.ident,'model_'+state,{'callKey':key,'error':str(e)[:500]})
            raise


class RunObserver:
    def __init__(self, queue, ident, owner=None):
        self.queue, self.ident = queue, ident
        with queue.db() as c:
            self.owner = owner or c.execute('SELECT lease_owner FROM jobs WHERE id=?',(ident,)).fetchone()['lease_owner']

    async def __call__(self, event, data):
        key = data['operationKey']
        with self.queue.db(immediate=True) as c:
            job = c.execute('SELECT status,limits_json,lease_owner FROM jobs WHERE id=?',(self.ident,)).fetchone()
            if job['status'] != 'running' or job['lease_owner'] != self.owner:
                raise asyncio.CancelledError()
            limits = unlimited_limits(json.loads(job['limits_json']))
            prior = c.execute('SELECT state FROM tool_operations WHERE job_id=? AND operation_key=?',(self.ident,key)).fetchone()
            if event == 'tool_started':
                # Deterministic reads can safely repeat during node replay;
                # they do not consume another distinct tool budget entry.
                if not prior:
                    if data['tool']=='search_market' and limits['maxMarketSearches']==0:
                        raise ExecutionError('当前任务未启用市场检索', 'MARKET_SEARCH_DISABLED')
                elif data['tool']=='search_market':
                    saved = c.execute('SELECT payload FROM tool_operations WHERE job_id=? AND operation_key=?',(self.ident,key)).fetchone()
                    cached = json.loads(saved['payload'])
                    if prior['state']=='completed' and 'toolResult' in cached:
                        self.queue.event(c,self.ident,'market_replayed',{'operationKey':key})
                        return cached['toolResult']
                    # A search interrupted inside a node is not safely
                    # repeatable without provider idempotency support.
                    raise ExecutionError('市场检索已发起；为避免重复额度消耗，本节点须核对后另建任务', 'MARKET_REPLAY_BLOCKED')
            payload = json.dumps(data,ensure_ascii=False)
            state = {'tool_started':'started','tool_completed':'completed','tool_failed':'failed'}[event]
            c.execute('INSERT INTO tool_operations VALUES(?,?,?,?,?,?,?) ON CONFLICT(job_id,operation_key) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated_at=excluded.updated_at',
                (self.ident,key,data['tool'],state,payload,stamp(),stamp()))
            self.queue.event(c,self.ident,event,data)

    async def progress(self, ident, message):
        if not self.queue.progress(ident,message,self.owner):
            raise asyncio.CancelledError()

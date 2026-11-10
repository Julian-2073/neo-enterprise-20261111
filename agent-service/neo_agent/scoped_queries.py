"""Read-only paging of the current frozen canonical records and typed results.

Calculations originate in TS; these tools filter and read, never recalculate or
fetch current live rows. Raw records are not eagerly copied into model prompts.
"""
from .engine import source_hash

def page(rows,args):
    cursor=args.get('cursor',0);limit=args.get('limit',20)
    if type(cursor) is not int or cursor<0 or type(limit) is not int or not 1<=limit<=100:raise ValueError('分页范围无效')
    return {'records':rows[cursor:cursor+limit],'total':len(rows),'cursor':cursor,'limit':limit,'hasMore':cursor+limit<len(rows),'nextCursor':cursor+limit if cursor+limit<len(rows) else None}

def check_scope(basis,data):
    for key in ('businessId','dataNature','generationId'):
        if data.get(key)!=basis.get(key):raise ValueError('工具资料超出冻结企业、性质或代次')

def scoped_read(basis,name,args):
    if not isinstance(args,dict):raise ValueError('查询参数无效')
    if name=='read_knowledge':
        from .current_knowledge import read_knowledge
        return read_knowledge({'snapshot':basis,'knowledge':basis.get('knowledge')},args.get('query',''),min(args.get('limit',6),6),args.get('cursor',0))
    active=basis.get('activeScope',{});explicit=dict(args);args={**{k:v for k,v in {'entityId':active.get('entityId'),'channelId':active.get('channelId'),'start':active.get('period',{}).get('start'),'end':active.get('period',{}).get('end')}.items() if v is not None},**args}
    if 'channelId' in active and 'channelId' not in explicit:args['channelId']=active['channelId']
    allowed={'entryType','cursor','limit','id','kind','entityId','channelId','start','end','typed','scenarioId','pointCursor','pointLimit'}
    if set(args)-allowed:raise ValueError('查询含未授权参数')
    if name=='read_saved_records':
        if args.get('kind') in ('order','refund','inventory','expense') or 'entryType' in args:return {'status':'wrong_record_domain','recordDomain':'saved_decisions_and_calculations','reason':'read_saved_records仅用于已保存选择和情景计算；退款/支付经营明细须用read_frozen_records kind=order entryType=refund/paid，不能据此认定经营明细未冻结','businessRecordsAvailability':'not_assessed'}
        data=basis.get('savedRecords')
        if not data:return {'status':'missing','reason':'本轮未冻结保存记录；不能解释为没有记录'}
        check_scope(basis,data)
        if 'fullRecords' not in data:return {'status':'partial','reason':'历史任务仅含目录样本；需新轮次读取完整参数','records':data.get('records',[])}
        rows=[r for r in data['fullRecords'] if (not args.get('id') or r['id']==args['id']) and (not args.get('kind') or r['kind']==args['kind'])]
        for r in rows:
            if r.get('businessId')!=basis['businessId'] or r.get('dataNature')!=basis['dataNature'] or r.get('generationId')!=basis['generationId']:raise ValueError('保存记录归属不一致')
        typed=args.get('typed',False)
        if type(typed) is not bool:raise ValueError('typed须为布尔值')
        out=page(rows,args)
        if not typed:out['records']=[{k:r.get(k) for k in ('id','kind','createdAt','title','reason','status','contentHash')} for r in out['records']]
        if typed:
            presented=[]
            for record in out['records']:
                value=dict(record)
                if value.get('results') is not None:
                    results=[r for r in value['results'] if not args.get('scenarioId') or r['id']==args['scenarioId']]
                    value['results']=[{**{k:v for k,v in r.items() if k!='points'},'pointsPage':page(r.get('points',[]),{'cursor':args.get('pointCursor',0),'limit':args.get('pointLimit',20)})} for r in results]
                if value.get('forecast'):
                    f=value['forecast'];value['forecast']={**{k:v for k,v in f.items() if k!='points'},'pointsPage':page(f.get('points',[]),{'cursor':args.get('pointCursor',0),'limit':args.get('pointLimit',20)})}
                presented.append(value)
            out['records']=presented
        return {**out,'registryHash':data['registryHash'],'typed':typed,'notice':'保存选择不代表执行；只有typed结果可以用于方案数值比较'}
    data=basis.get('queryData')
    if not data:return {'status':'missing','reason':'历史冻结输入没有全量记录接口；须创建新轮次'}
    check_scope(basis,data)
    start=args.get('start',data['period']['start']);end=args.get('end',data['period']['end'])
    if start<data['period']['start'] or end>data['period']['end'] or start>end:raise ValueError('查询期间超出冻结范围')
    for r in data['records']:
        if r.get('knownAt','')>data.get('knownAt','9999'):raise ValueError('记录可知时间超过冻结版本')
    if name=='read_diagnostics':
        d=basis.get('diagnostics')
        if not d:return {'status':'missing','reason':'该历史输入未冻结诊断计算'}
        requested={'period':{'start':start,'end':end},'entityId':args.get('entityId'),'channelId':args.get('channelId'),'channelMode':'exact' if 'channelId' in args else 'all'}
        if d.get('scope')!=requested:
            return {'status':'unsupported','reason':'本轮只冻结了指定范围的TS诊断计算；请用该范围读取，或开启新轮次重算所需范围。','requestedScope':requested,'supportedScope':d.get('scope'),'metricClaims':{}}
        rows=[r for r in d['contributions'] if (not args.get('entityId') or r['entityId']==args['entityId']) and ('channelId' not in args or r['channelId']==args['channelId'])]
        metric_claims={}
        for period in ('current','previous'):
            if d.get(period):metric_claims.update({'diagnostic:'+period+':'+k:v for k,v in d[period]['metrics'].items()})
        metric_claims.update({'diagnostic:change:'+k:v for k,v in d.get('changes',{}).items()})
        selected=page(rows,args)
        for r in selected['records']:metric_claims.update({'contribution:'+str(r['entityId'])+':'+str(r.get('channelId'))+':'+k:v for k,v in r['metrics'].items()})
        return {**{k:v for k,v in d.items() if k!='contributions'},'contributionsPage':selected,'metricClaims':metric_claims,'queryHash':source_hash(requested),'status':'complete'}
    if name!='read_frozen_records':raise ValueError('未授权工具')
    if 'entryType' in args and args['entryType'] not in ('paid','refund'):raise ValueError('entryType仅可选paid/refund')
    rows=[r for r in data['records'] if start<=r['businessDate']<=end and all(not args.get(k) or r.get(k)==args[k] for k in ('id','kind','entityId','entryType')) and ('channelId' not in args or r.get('channelId')==args['channelId'])]
    return {**page(rows,args),'scope':{**{k:data[k] for k in ('businessId','dataNature','generationId')},'start':start,'end':end},'queryHash':source_hash(args),'notice':'完整匹配记录分页；明细页不能冒充总量或重新计算指标'}

SCOPED_TOOLS=[{'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':{**{k:{'type':['string','null'] if k=='channelId' else 'string'} for k in ('id','kind','entryType','entityId','channelId','start','end','scenarioId')},'cursor':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':100},'typed':{'type':'boolean'},'pointCursor':{'type':'integer','minimum':0},'pointLimit':{'type':'integer','minimum':1,'maximum':100},'query':{'type':'string','maxLength':1000}},'additionalProperties':False}}} for name,description in [('read_knowledge','可改写query检索当前知识；模型按适用性、支持和相关性排序引用，候选不能当规则'),('read_frozen_records','按当前冻结范围分页读取完整经营记录，可按实体渠道期间ID筛选'),('read_diagnostics','读取后台计算的前后期、身份旅程、退款成本毛利和实体渠道贡献；缺失不填零'),('read_saved_records','仅用于已保存经营选择和情景计算，不用于退款/支付明细；经营明细使用read_frozen_records kind=order entryType=refund/paid。分页读取保存记录；typed=true取得冻结方案参数和实际计算结果，不能用目录标题代替计算')]]

def model_basis(basis):
    result={k:v for k,v in basis.items() if k not in ('queryData','diagnostics','savedRecords','knowledge')}
    if 'queryData' in basis:result['recordsAvailable']={'total':len(basis['queryData']['records']),'scope':{k:basis['queryData'][k] for k in ('businessId','dataNature','generationId','period','asOf')}}
    if 'diagnostics' in basis:result['diagnostics']={k:v for k,v in basis['diagnostics'].items() if k!='contributions'};result['diagnostics']['contributionTotal']=len(basis['diagnostics']['contributions'])
    if 'savedRecords' in basis:result['savedRecords']={k:v for k,v in basis['savedRecords'].items() if k!='fullRecords'}
    return compact_calculation_view(result)


def compact_calculation_view(value):
    """Bound provenance display; preserve metric values, statuses and provenance hash."""
    if isinstance(value,list):return [compact_calculation_view(v) for v in value]
    if not isinstance(value,dict):return value
    out={k:compact_calculation_view(v) for k,v in value.items() if k not in ('points',)}
    if isinstance(value.get('points'),list):out.update(pointCount=len(value['points']),pointsHash=source_hash(value['points']),pointsNotice='Read typed results through paginated tools; totals use all calculated points.')
    if isinstance(value.get('evidenceIds'),list) and len(value['evidenceIds'])>8:out.update(evidenceIds=value['evidenceIds'][:8],evidenceCount=len(value['evidenceIds']),evidenceIdsAreSample=True,evidenceHash=source_hash(value['evidenceIds']))
    return out


def model_conversation(context, *, count_query=False):
    """Bound prompt history independently of session length; stored runs keep full text."""
    def bounded(v):
        if isinstance(v,str):return v[:240]+('…[full text in referenced run]' if len(v)>240 else '')
        if isinstance(v,list):return [bounded(x) for x in v[:12]]
        if isinstance(v,dict):return {k:bounded(x) for k,x in v.items() if k not in ('finding','evidenceIds','scenarioComparison')}
        return v
    view={k:v for k,v in context.items() if k not in ('recentTurns','history','summary','accessHash')}
    if count_query:
        # Quantity queries reread current facts. Historical hypotheses, rule
        # locations and failed-run dossiers cannot establish these quantities.
        # Keep scope/version changes and user constraints; immutable runs retain
        # the entire dialogue, including unfinished investigations.
        keys=('version','versionChanged','sourceChanged','previousSourceKind',
              'currentSourceKind','previousInputId','currentInputId',
              'invalidatedDependencies','unresolvedReferences','userStatements',
              'notice','active')
        view={k:view[k] for k in keys if k in view}
        memory=context.get('memory') or {}
        view['memory']={'status':memory.get('status'),
                        'constraints':memory.get('constraints',[]),
                        'unfinishedInquiryCount':len(memory.get('unfinishedInquiry',[])),
                        'notice':'Historical context only; quantities must be reread for this turn.'}
    if 'versions' in view:view['versions']={'keys':list(view['versions']),'digest':source_hash(view['versions']),'notice':'Exact version hashes retained in immutable request; current/previous input and changed flags below are authoritative.'}
    if 'active' in view:view['active']={k:v for k,v in view['active'].items() if k not in ('temporaryHypotheses','unfinishedInquiry')}
    return bounded(view)


def lossless_prompt_view(value):
    """Reference repeated JSON subtrees, preserving every value and null/status.

    Paths point to earlier exact objects in this same payload, never another
    metric scope or historical run. Stored source and checker remain unchanged.
    """
    import json
    seen={}
    def visit(item,path):
        if isinstance(item,(dict,list,str)):
            wire=json.dumps(item,ensure_ascii=False,sort_keys=True,separators=(',',':'))
            if len(wire.encode())>80:
                if wire in seen:return {'$sameAs':seen[wire]}
                seen[wire]=path
        if isinstance(item,dict):return {k:visit(v,path+'/'+str(k).replace('~','~0').replace('/','~1')) for k,v in item.items()}
        if isinstance(item,list):return [visit(v,path+'/'+str(i)) for i,v in enumerate(item)]
        return item
    return visit(value,'')

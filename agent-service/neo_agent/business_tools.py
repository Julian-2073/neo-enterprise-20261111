"""A business map over the authorized immutable input, never arbitrary SQL."""
from collections import defaultdict
from urllib.parse import quote

def view_id(snapshot_id,view,*args):
    return snapshot_id+':view:'+':'.join(quote(str(x),safe='') for x in (view,*args))

from .business_queries import query_facts, scope_for, matching_rows, aggregate, EVENT_STAGES

def customer_journey_window(journey,start,end):
    """Return the named frozen journey window matching an exact query scope."""
    if not isinstance(journey,dict):return None
    for name in ('period','recent','previous'):
        block=journey.get(name,{})
        if block.get('start')==start and block.get('end')==end:return name
    return None

def scoped_customer_journey(journey,start,end):
    """Expose only journey windows valid for the exact requested period.

    A recent-window question is allowed to compare the frozen adjacent previous
    window. It must not be rejected merely because the parent journey artifact
    also contains the longer all-period view.
    """
    name=customer_journey_window(journey,start,end)
    if not name:return None
    metadata={k:journey[k] for k in ('version','snapshotId','businessId','dataNature','rule','evidenceId','limitations') if k in journey}
    if name=='period':return {**metadata,**{k:v for k,v in journey.items() if k not in ('weekly',)}}
    windows={name:journey[name]}
    if name=='recent' and isinstance(journey.get('previous'),dict):windows['previous']=journey['previous']
    if name=='previous' and isinstance(journey.get('recent'),dict):windows['recent']=journey['recent']
    return {**metadata,'requestedWindow':name,**windows}

def aggregate_facts(rows):
    groups={}
    for row in rows:
        if row['kind']=='inventory':continue
        f=row['fact'];key=(f.get('product_id'),f.get('channel'))
        groups.setdefault(key,[]).append(row)
    return [{'productId':key[0],'channel':key[1],**aggregate(group)} for key,group in groups.items()]

def describe_business(env):
    s=env['snapshot']; facts=env.get('facts',[]); tables=defaultdict(set)
    for item in facts:
        tables[item.get('kind','unknown')].update(item.get('fact',{}).keys())
    active=env.get('conversation',{}).get('active',{});journey=env.get('customerJourney')
    journey_period=(journey or {}).get('period',{})
    journey_bounded=all(journey_period.get(k) for k in ('start','end'))
    requested=active.get('period') or {'start':s['periodStart'],'end':s['periodEnd']}
    journey_window=customer_journey_window(journey,requested.get('start'),requested.get('end'))
    journey_matches=bool(journey_window) and not (active.get('entityId') or 'channelId' in active or s.get('productId') or s.get('channel'))
    return {
        'availableDerivedViews':({'customerJourney':{'matchesCurrentScope':journey_matches,'scopeStatus':'current' if journey_matches else 'unverified_legacy_period' if not journey_bounded else 'outside_current_scope','matchedWindow':journey_window,'version':journey.get('version'),'evidenceId':journey.get('evidenceId'),'period':{k:v for k,v in env['customerJourney'][journey_window or 'period'].items() if k in ('start','end','counts')},'transitionRatesAvailable':any(r.get('rate') is not None for r in env['customerJourney'][journey_window or 'period'].get('transitions',[]))}} if env.get('customerJourney') else {}),
        'businessId':s['businessId'],'businessName':s.get('businessName'),
        'snapshotId':s['id'],'asOf':s['asOf'],'dataNature':s['dataNature'],
        'range':{'start':s['periodStart'],'end':s['periodEnd']},
        'availableFactViews':{k:sorted(v) for k,v in tables.items()},
        'relationships':['product_id → products.id','sku_id → skus.id → product_id',
                         'channel + business_date → channel spending and orders',
                         'sku_id + warehouse_id + business_date → sellable stock',
                         'arrivals.skuId + warehouseId + date → future supply'],
        'displayNames':{'products':[{'id':p['id'],'name':p.get('name') or '商品名称待确认'} for p in env.get('domain',{}).get('products',[])],'channels':({c['id']:c.get('name') or '渠道名称待确认' for c in env.get('domain',{}).get('channels',[])} or {'douyin':'抖音','tmall':'天猫','xiaohongshu':'小红书','content':'渠道名称待确认'})},
        'units':{'events':'行为次数','orders':'订单笔数','quantity':'件','databaseMoney':'分','modelMoney':'元'},
        'businessRules':['行为量与订单量不构成去重客户漏斗','在途到货前不能计为可售',
                         '补货不自动创造需求','贡献毛利不等于净利润','外部变化不直接证明内部变化的原因',
                         '商品角色、渠道效率目标与安全线只使用已保存定义；没有定义须指出缺口'],
        'domain':env.get('domain',{}),'limitations':s.get('limitations',[]),
    }

def read_fact_view(env,section,args):
    # Both public date spellings refer to one bounded query; contradictions fail.
    args=dict(args)
    for alias,canonical in [('start','periodStart'),('end','periodEnd')]:
        if alias in args:
            if canonical in args and args[canonical]!=args[alias]:raise ValueError('日期别名与查询期间不一致')
            args[canonical]=args.pop(alias)
    result=query_facts(env,section,args)
    scope=result['scope']; s=env['snapshot']; rows=matching_rows(env,section,scope)
    weekly=[];evidence_ids=[]
    for week in s.get('data',{}).get('weeks',[]):
        start=max(week['start'],scope['periodStart']);end=min(week['end'],scope['periodEnd'])
        if start>end:continue
        selected=[x for x in rows if x['kind']!='inventory' and start<=x['fact']['business_date']<=end]
        weekly.append({'start':start,'end':end,'groups':aggregate_facts(selected)})
        if not scope.get('skuId') and start==week['start'] and end==week['end']:
            metrics=('paidOrders','netRevenueCents') if section=='supply' else ('A1','A2','A3','paidOrders','netRevenueCents','spendCents')
            order_status=aggregate(selected)['metricStatus']['paidOrders']['status']
            evidence_ids.extend(view_id(s['id'],'week',week['start'],metric,scope['productId'] or '',scope['channel'] or '') for metric in metrics if metric!='paidOrders' or order_status=='observed')
    # Existing inventory evidence endpoint represents snapshot asOf, never a historical cutoff.
    if section=='supply' and not scope.get('skuId') and scope['productId'] and scope['inventoryAsOf']==s['asOf'] and result['inventoryPositionCount'] and any(r.get('product_id')==scope['productId'] for r in s.get('data',{}).get('inventory',[])):
        evidence_ids.append(view_id(s['id'],'inventory',scope['productId']))
    result.update(weeklyMetrics=weekly,scopedEvidenceIds=evidence_ids)
    result['scope'].update(start=scope['periodStart'],end=scope['periodEnd'])
    return result

def validate_organization(finding,known,context):
    report=finding.organization
    if not report:return
    scenario_ids={x['id'] for x in context.get('scenarios',[])+context.get('forecasts',[])}
    decision_ids={x['id'] for x in context.get('decisions',[])}
    for item in report.priorities:
        if any(x not in known for x in item.evidenceIds):raise ValueError('整理结果引用了不存在的证据')
    if any(x.scenarioId not in scenario_ids for x in report.comparisons):raise ValueError('整理结果引用了不存在的方案')
    if any(x.decisionId not in decision_ids for x in report.savedChoices):raise ValueError('整理结果引用了不存在的老板选择')

"""Deterministic aggregations over the frozen, authorized facts only.

No database reads, guessed customer counts, calendar zero filling, or live data.
Coverage describes imports, not independent proof that a slice is complete.
"""
from datetime import date, timedelta
import hashlib
import json

EVENT_STAGES = {'impression':'A1','content_view':'A1','artwork_view':'A1',
    'engaged':'A2','click':'A2','save':'A2','follow':'A2','like':'A2','share':'A2',
    'add_to_cart':'A3','inquiry':'A3','lead':'A3','form_submit':'A3',
    'relationship':'A5','repeat_purchase':'A5','referral':'A5','review':'A5'}
KINDS = {'conversion': {'orders', 'events', 'expenses'}, 'supply': {'inventory', 'orders'},
         'market': {'orders', 'events', 'expenses'}}


def iso_day(value):
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError('期间须为 YYYY-MM-DD')
    try:
        return date.fromisoformat(value)
    except ValueError as e:
        raise ValueError('期间日期无效') from e


def scope_for(env, args):
    s = env['snapshot']
    lower, upper = iso_day(s['periodStart']), iso_day(s['periodEnd'])
    start = iso_day(args.get('periodStart', s['periodStart']))
    end = iso_day(args.get('periodEnd', s['periodEnd']))
    if start > end or start < lower or end > upper or end > iso_day(s['asOf']):
        raise ValueError('查询期间超出授权冻结快照；扩大范围须创建新输入版本')
    for argument, pinned in [('productId', s.get('productId')), ('channel', s.get('channel'))]:
        if argument in args and (not isinstance(args[argument], str) or not args[argument].strip()):
            raise ValueError('商品或渠道筛选不能为空')
        if pinned and args.get(argument) and args[argument] != pinned:
            raise ValueError('商品或渠道超出授权冻结范围')
    active_sku=env.get('conversation',{}).get('active',{}).get('skuId')
    if args.get('skuId') is not None and (not isinstance(args['skuId'],str) or not args['skuId'].strip()):raise ValueError('规格筛选无效')
    if active_sku and args.get('skuId',active_sku)!=active_sku:raise ValueError('规格超出当前讨论范围')
    grain = args.get('grain', 'period')
    if grain not in ('period', 'week'):
        raise ValueError('汇总粒度须为 period 或 week')
    for field in ('aggregateOffset','inventoryOffset','recordCursor'):
        offset = args.get(field, 0)
        if type(offset) is not int or offset < 0:
            raise ValueError('汇总分页偏移无效')
    if type(args.get('comparePrevious', False)) is not bool:
        raise ValueError('comparePrevious 须为布尔值')
    return {'periodStart':start.isoformat(), 'periodEnd':end.isoformat(),
            'productId':args.get('productId') or s.get('productId'),'skuId':args.get('skuId') or env.get('conversation',{}).get('active',{}).get('skuId'),
            'channel':args.get('channel') or s.get('channel'), 'grain':grain}


def matching_rows(env, section, scope):
    s = env['snapshot']
    selected = []
    for item in env.get('facts', []):
        if item.get('kind') not in KINDS[section]:
            continue
        f = item.get('fact', {})
        # Additional identities cannot expand the service-authenticated envelope.
        for key, expected in [('business_id', s['businessId']), ('data_nature', s['dataNature'])]:
            if key in f and f[key] != expected:
                raise ValueError('冻结事实含跨企业或数据性质引用')
        if scope.get('skuId') and f.get('sku_id') != scope['skuId']:
            continue
        if scope['productId'] and f.get('product_id') != scope['productId']:
            continue
        if scope['channel'] and item['kind']!='inventory' and f.get('channel') != scope['channel']:
            continue
        d = f.get('business_date')
        if not d:
            continue
        iso_day(d)
        if item['kind']=='inventory' and env['snapshot']['periodStart'] <= d <= scope.get('inventoryAsOf',scope['periodEnd']):
            selected.append(item)
        elif item['kind']!='inventory' and scope['periodStart'] <= d <= scope['periodEnd']:
            selected.append(item)
    return selected


def measure(rows, field, sign=None):
    """A missing row/field never becomes a real zero, including partial sums."""
    known = []
    missing = 0
    for row in rows:
        f = row['fact']
        v = f.get(field)
        if v is None:
            missing += 1
        elif type(v) not in (int, float) or v < 0 or v != v or v == float('inf'):
            raise ValueError('冻结事实包含非法非负数值：' + field)
        else:
            known.append(v * (sign(f) if sign else 1))
    status = 'missing' if not rows or not known else 'partial' if missing else 'observed'
    return (sum(known) if status == 'observed' else None,
            {'status':status, 'knownValue':sum(known) if known else None,
             'missingRows':missing, 'rowCount':len(rows)})


def count_orders(rows):
    """Count stable source/order pairs, not import batches or unscoped IDs.

    Old envelopes without a source can still expose their legacy ID cardinality
    for audit. It is not a verified order count and cannot enter comparisons.
    """
    identities=set();missing_sources=0;missing_orders=0;missing_rows=0;legacy_ids=set()
    for row in rows:
        # source_id supports older raw envelopes; sourceId is the frozen API form.
        sources=[row.get(key) for key in ('sourceId','source_id')]
        sources=[v for v in sources if isinstance(v,str) and v.strip()]
        if len(set(sources))>1:raise ValueError('冻结事实的来源身份冲突，不能确定订单笔数')
        source=sources[0] if sources else None
        order=row['fact'].get('order_id')
        order=order if isinstance(order,str) and order.strip() else None
        missing_sources+=source is None;missing_orders+=order is None
        if source is None and order is not None:legacy_ids.add(order)
        if source is None or order is None:missing_rows+=1
        else:identities.add((source,order))
    status='missing' if not rows or not identities else 'partial' if missing_rows else 'observed'
    metadata={'status':status,'knownValue':len(identities) if identities else None,
              'rowCount':len(rows),'missingRows':missing_rows,
              'missingSourceRows':missing_sources,'missingOrderIdRows':missing_orders,
              'legacyDistinctOrderIds':len(legacy_ids) if legacy_ids else None,
              'identityBasis':'stable_source_id + order_id; batches and line IDs are not order identities',
              'reason':('订单缺少稳定来源或订单号；旧订单号去重数量仅供审计，不能视为已确认笔数'
                        if missing_rows else '本范围没有相应订单记录' if not rows else None)}
    return (len(identities) if status=='observed' else None,metadata)


def aggregate(rows):
    kinds = sorted({r['kind'] for r in rows})
    orders = [r for r in rows if r['kind'] == 'orders']
    paid = [r for r in orders if r['fact'].get('entry_type') == 'paid']
    refunds = [r for r in orders if r['fact'].get('entry_type') == 'refund']
    expenses = [r for r in rows if r['kind'] == 'expenses']
    classified_orders = [r for r in orders if r['fact'].get('entry_type') in ('paid','refund')]
    result = {'factCount':len(rows), 'kinds':kinds, 'metricStatus':{}, 'behaviorCounts':{}}
    sign = lambda f: -1 if f['entry_type'] == 'refund' else 1
    for name, rs, field, modifier in [
        ('paidUnits',paid,'quantity',None), ('refundUnits',refunds,'quantity',None),
        ('netRevenueCents',classified_orders,'amount_cents',sign),
        ('variableCostCents',classified_orders,'variable_cost_cents',sign),
        ('spendCents',expenses,'amount_cents',None)]:
        result[name], result['metricStatus'][name] = measure(rs, field, modifier)
        if name.endswith('Cents'):
            result['metricStatus'][name]['knownValueCents']=result['metricStatus'][name].pop('knownValue')
        if name in ('netRevenueCents','variableCostCents') and len(classified_orders) != len(orders):
            result[name] = None
            result['metricStatus'][name].update(status='partial',missingClassificationRows=len(orders)-len(classified_orders))
    result['netUnits'] = (result['paidUnits'] - result['refundUnits']
                          if result['paidUnits'] is not None and result['refundUnits'] is not None else None)
    # No refund rows means no observed refunds, rather than an invented zero.
    # Revenue itself is still a valid signed sum over the records that do exist.
    for stage in ('A1','A2','A3','A5'):
        rs = [r for r in rows if r['kind'] == 'events' and EVENT_STAGES.get(r['fact'].get('event_type')) == stage]
        result['behaviorCounts'][stage], result['metricStatus'][stage] = measure(rs, 'quantity')
    for name, rs in [('paidOrders',paid),('refundOrders',refunds)]:
        result[name], result['metricStatus'][name] = count_orders(rs)
    nums = [result[k] for k in ('netRevenueCents','variableCostCents','spendCents')]
    result['contributionMarginCents'] = nums[0]-nums[1]-nums[2] if all(v is not None for v in nums) else None
    result['factIds'] = [r['id'] for r in rows[:10]]
    result['factIdsAreSample'] = len(rows) > 10
    result['matchingFactIdsHash'] = hashlib.sha256(json.dumps(sorted(r['id'] for r in rows)).encode()).hexdigest()
    return result


def weeks(start, end):
    start, end = iso_day(start), iso_day(end)
    cursor = start - timedelta(days=start.weekday())
    while cursor <= end:
        stop = cursor + timedelta(days=6)
        yield {'weekStart':cursor.isoformat(), 'periodStart':max(start,cursor).isoformat(),
               'periodEnd':min(end,stop).isoformat(), 'completeWeek':start <= cursor and stop <= end}
        cursor += timedelta(days=7)


def coverage(env, scope, kind):
    imports = [c for c in env['snapshot'].get('coverage', []) if c.get('kind') == kind]
    if not imports:
        return 'missing'
    start, end = iso_day(scope['periodStart']), iso_day(scope['periodEnd'])
    # Every source that participates must declare this range; unioning sources
    # would incorrectly conceal a missing period on one source.
    for source in {c.get('sourceId') for c in imports}:
        cursor = start
        for a, b in sorted((iso_day(c['start']),iso_day(c['end'])) for c in imports if c.get('sourceId') == source):
            if a <= cursor <= b:
                cursor = b + timedelta(days=1)
        if cursor <= end:
            return 'partial'
    return 'declared'


def inventory_positions(rows):
    # Sum only the last observation for each SKU/warehouse, never sum stock
    # across weeks. Preserve ties as a conflict rather than double counting.
    latest = {}
    for r in rows:
        if r['kind'] != 'inventory':
            continue
        f = r['fact']
        key = (f.get('sku_id'), f.get('warehouse_id'))
        if not all(key):
            raise ValueError('库存缺少 SKU 或仓库，无法确定时点')
        stamp = (f['business_date'], f.get('occurred_at', ''))
        prior = latest.get(key)
        if prior and stamp == prior[0] and f != prior[1]['fact']:
            raise ValueError('同一SKU仓库时点有冲突库存，须创建已解决的新输入版本')
        if not prior or stamp > prior[0]:
            latest[key] = (stamp, r)
    return [latest[k][1] for k in sorted(latest)]


def inventory_summary(rows):
    rs = inventory_positions(rows)
    out = {'positionCount':len(rs), 'basis':'各SKU×仓库在查询期间内最后一条库存记录，不是周度库存相加',
           'observationDates':sorted({r['fact']['business_date'] for r in rs}), 'metricStatus':{}}
    for key, field in [('sellableUnits','sellable_units'),('inTransitUnits','in_transit_units'),('inventoryCostCents','inventory_cost_cents')]:
        out[key], out['metricStatus'][key] = measure(rs, field)
        if key.endswith('Cents'):
            out['metricStatus'][key]['knownValueCents']=out['metricStatus'][key].pop('knownValue')
    return out


def covered_aggregate(env, rows, scope):
    result = aggregate(rows)
    if scope.get('skuId') and any(r['kind']=='expenses' and r['fact'].get('product_id')==scope.get('productId') and not r['fact'].get('sku_id') and scope['periodStart']<=r['fact'].get('business_date','')<=scope['periodEnd'] for r in env.get('facts',[])):
        result['spendCents']=None;result['contributionMarginCents']=None
        result['metricStatus']['spendCents']={'status':'missing','knownValueCents':None,'reason':'商品费用未分配到当前规格，禁止猜测分摊'}
    known = result['contributionMarginCents']
    complete = all(coverage(env, scope, kind) == 'declared' for kind in ('orders', 'expenses'))
    # A numeric partial sum is useful for reconciliation, never a complete
    # contribution margin. Match the gateway's canonical financial contract.
    if not complete:
        result['contributionMarginCents'] = None
    result['metricStatus']['contributionMarginCents'] = {
        'status': 'observed' if complete and known is not None else 'partial' if known is not None else 'missing',
        'knownValueCents': known,
        'reason': None if complete else '订单或费用未完整覆盖统计期'}
    return result


def query_facts(env, section, args):
    if section not in KINDS or not isinstance(args, dict):
        raise ValueError('无效业务分区或查询')
    scope = scope_for(env, args)
    limit=args.get('recordLimit',20)
    if type(limit) is not int or not 1<=limit<=100:raise ValueError('明细分页大小须为1至100')
    if args.get('recordId') is not None and not isinstance(args['recordId'],str):raise ValueError('明细标识无效')
    if section=='supply':
        scope['inventoryAsOf']=args.get('periodEnd',env['snapshot']['asOf'])
    rows = matching_rows(env, section, scope)
    detail=sorted([r for r in rows if not args.get('recordId') or r['id']==args['recordId']],key=lambda r:r['id'])
    cursor=args.get('recordCursor',0)
    total = covered_aggregate(env, rows, scope)
    groups = {}
    channel_groups = {}
    for r in rows:
        if r['kind'] == 'inventory':
            continue
        f = r['fact']
        key = (f.get('product_id'), f.get('channel'))
        groups.setdefault(key, []).append(r)
        channel_groups.setdefault(f.get('channel'), []).append(r)
    periods = list(weeks(scope['periodStart'], scope['periodEnd'])) if scope['grain'] == 'week' else [scope]
    groups_list = []
    for key in sorted(groups, key=lambda k:(k[0] or '',k[1] or '')):
        for period in periods:
            rs = [r for r in groups[key] if period['periodStart'] <= r['fact']['business_date'] <= period['periodEnd']]
            period_fields={k:period[k] for k in ('weekStart','periodStart','periodEnd','completeWeek') if k in period}
            groups_list.append({**period_fields, 'productId':key[0], 'channel':key[1], **covered_aggregate(env, rs, period)})
    channel_groups_list = []
    for channel in sorted(channel_groups, key=lambda value:value or ''):
        for period in periods:
            rs = [r for r in channel_groups[channel] if period['periodStart'] <= r['fact']['business_date'] <= period['periodEnd']]
            period_fields={k:period[k] for k in ('weekStart','periodStart','periodEnd','completeWeek') if k in period}
            channel_groups_list.append({**period_fields, 'channel':channel, **covered_aggregate(env, rs, period)})
    source_ids = list(dict.fromkeys(env['snapshot'].get('evidenceIds', {}).values()))
    query_evidence = {'businessId':env['snapshot']['businessId'], 'snapshotId':env['snapshot']['id'],
        'dataNature':env['snapshot']['dataNature'], 'asOf':env['snapshot']['asOf'],
        'ontologyRef':env.get('ontologyRef'), 'scope':scope, 'sourceEvidenceIds':source_ids,
        'matchingFactIdsHash':total['matchingFactIdsHash'], 'factCount':len(rows),
        'method':'frozen-facts-aggregation-v3', 'scopeOfSourceEvidence':'源证据为快照范围；本查询范围与记录摘要见scope及matchingFactIdsHash'}
    result = {'scope':scope, 'totals':total, 'factCount':len(rows),
        'productChannelAggregates':groups_list[args.get('aggregateOffset',0):args.get('aggregateOffset',0)+60],
        'channelAggregates':channel_groups_list,
        'aggregateCount':len(groups_list), 'nextAggregateOffset':args.get('aggregateOffset',0)+60 if args.get('aggregateOffset',0)+60 < len(groups_list) else None,
        'weeklyTotals':[dict(**p, **covered_aggregate(env, [r for r in rows if p['periodStart'] <= r['fact']['business_date'] <= p['periodEnd']], p)) for p in periods] if scope['grain']=='week' else [],
        'coverage':{k:coverage(env,scope,k) for k in sorted(KINDS[section])},
        'queryEvidence':query_evidence, 'facts':detail[cursor:cursor+limit], 'truncated':cursor+limit<len(detail),
        'recordsPage':{'total':len(detail),'cursor':cursor,'limit':limit,'hasMore':cursor+limit<len(detail),'nextCursor':cursor+limit if cursor+limit<len(detail) else None,'filters':{'recordId':args.get('recordId'),**scope}},
        'quality':{'undatedFactCount':sum(1 for r in env.get('facts',[]) if r.get('kind') in KINDS[section] and not r.get('fact',{}).get('business_date')),
                   'unclassifiedOrderCount':sum(1 for r in rows if r['kind']=='orders' and r['fact'].get('entry_type') not in ('paid','refund'))},
        'note':'totals与weeklyTotals由完整匹配事实计算，不是前20条样本推断。无记录或缺字段为null；明确零值为0。订单笔数按稳定来源与订单号去重；缺少来源或订单号时为null，旧订单号去重数仅供审计。覆盖为导入声明，不是独立完整性证明。'}
    if section == 'supply':
        result['inventoryPosition'] = inventory_summary(rows)
        result['inventoryPosition']['asOf']=scope['inventoryAsOf']
        result['inventoryPosition']['channelAllocation']='not_available; stock is product × warehouse, not channel stock'
        positions=inventory_positions(rows)
        offset=args.get('inventoryOffset',0)
        result['inventoryPositions']=positions[offset:offset+60]
        result['inventoryPositionCount']=len(positions)
        result['nextInventoryOffset']=offset+60 if offset+60<len(positions) else None
        for p in result['weeklyTotals']:
            p['inventoryPosition']=inventory_summary([r for r in rows if r['fact']['business_date'] <= p['periodEnd']])
    if args.get('comparePrevious'):
        start = iso_day(scope['periodStart'])
        days = (iso_day(scope['periodEnd']) - start).days + 1
        prior_scope = {**scope, 'periodStart':(start-timedelta(days=days)).isoformat(), 'periodEnd':(start-timedelta(days=1)).isoformat()}
        if prior_scope['periodStart'] < env['snapshot']['periodStart']:
            result['previousPeriod'] = {'status':'missing', 'scope':prior_scope, 'totals':None,
                'reason':'前期超出冻结授权输入；须创建包含历史的新输入版本，不能填零或查询实时库'}
        else:
            prior_args = {k:v for k,v in {**args, **prior_scope, 'comparePrevious':False, 'aggregateOffset':0}.items() if v is not None}
            previous = query_facts(env, section, prior_args)
            delta = {}
            for metric, kind in [('paidUnits','orders'),('paidOrders','orders'),('netRevenueCents','orders'),('spendCents','expenses'),('refundUnits','orders'),('refundOrders','orders'),('variableCostCents','orders'),('contributionMarginCents','expenses'),('A1','events'),('A2','events'),('A3','events'),('A5','events')]:
                a, b = (total['behaviorCounts'][metric], previous['totals']['behaviorCounts'][metric]) if metric.startswith('A') else (total[metric],previous['totals'][metric])
                complete = result['coverage'].get(kind)=='declared' and previous['coverage'].get(kind)=='declared'
                valid = a is not None and b is not None and complete
                delta[metric] = {'differenceCents' if metric.endswith('Cents') else 'difference':a-b if valid else None,
                    'relativeChange':(a-b)/b if valid and b != 0 else None,
                    'status':'comparable' if valid else 'missing',
                    'reason':None if valid and b else '前期为零，变化率无定义' if valid else '数值或来源覆盖不足，禁止增长推断'}
            result['previousPeriod'] = {'status':'available', 'scope':prior_scope,
                'totals':previous['totals'], 'weeklyTotals':previous['weeklyTotals'],
                'coverage':previous['coverage'], 'queryEvidence':previous['queryEvidence'], 'comparison':delta}
    return result

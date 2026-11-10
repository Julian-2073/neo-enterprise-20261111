"""Deterministic, auditable 28-day scenarios. No fixture forecasts or LLM arithmetic."""
from collections import defaultdict
from datetime import date, timedelta
from statistics import mean
import hashlib, json, math
from .contracts import ScenarioAssumptions

class CalculationError(ValueError): pass
CALCULATION_VERSION = 'scenario-v1.3'

def day(s): return date.fromisoformat(str(s)[:10])
def cents(v): return None if v is None else int(round(v))
def source_hash(value): return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()
def facts(env,kind): return [r['fact'] for r in env['facts'] if r['kind']==kind]

def series(env):
    s=env['snapshot']; start=day(s['periodStart']); end=day(s['periodEnd'])
    if end>day(s['asOf']): raise CalculationError('统计结束日不能晚于预测起点')
    first=start+timedelta(days=(7-start.weekday())%7)
    weeks=[]; cursor=first
    while cursor+timedelta(days=6)<=end:
        weeks.append(cursor); cursor+=timedelta(days=7)
    if len(weeks)<4: raise CalculationError('不足四个完整周，不能生成数值预测')
    # Coverage is a provider declaration, never independent proof of completeness.
    if not any(x['kind']=='orders' for x in s.get('coverage',[])): raise CalculationError('缺少订单覆盖记录')
    for kind in ['orders','expenses']:
        relevant=[c for c in s.get('coverage',[]) if c['kind']==kind]
        for source in {c['sourceId'] for c in relevant}:
            intervals=sorted((day(c['start']),day(c['end'])) for c in relevant if c['sourceId']==source)
            cursor=weeks[-4]
            for a,b in intervals:
                if a<=cursor<=b: cursor=b+timedelta(days=1)
            if kind=='orders' and cursor<=weeks[-1]+timedelta(days=6):
                raise CalculationError('最近四个完整周的订单来源覆盖不完整')
    return weeks

def prepare(env):
    weeks=series(env); rows=facts(env,'orders'); groups=defaultdict(list)
    for r in rows:
        # Do not discover groups or validate features from future/out-of-window orders.
        if not day(env['snapshot']['periodStart'])<=day(r['business_date'])<=day(env['snapshot']['periodEnd']): continue
        if not r.get('sku_id') or not r.get('product_id'): raise CalculationError('订单缺少商品/SKU，无法计算库存承接')
        groups[(r['product_id'],r['sku_id'],r['channel'])].append(r)
    if not groups: raise CalculationError('没有可预测的商品订单')
    latest_start=weeks[-4]; latest_end=weeks[-1]+timedelta(days=6)
    result=[]
    sku_products={}
    for (product,sku,channel),rs in sorted(groups.items(), key=lambda item: tuple(str(x) for x in item[0])):
        if sku in sku_products and sku_products[sku]!=product: raise CalculationError('同一 SKU 关联多个商品')
        sku_products[sku]=product
        sample=[r for r in rs if latest_start<=day(r['business_date'])<=latest_end]
        paid=[r for r in sample if r['entry_type']=='paid']; refunds=[r for r in sample if r['entry_type']=='refund']
        gross=sum(r['quantity'] for r in paid); qty=gross
        historical_paid=[r for r in rs if r['entry_type']=='paid']
        if not historical_paid: continue
        # A covered four-week zero is an observed zero, not a missing series.
        pricing_paid=paid or historical_paid
        pricing_units=sum(r['quantity'] for r in pricing_paid)
        if pricing_units<=0: raise CalculationError('支付件数必须为正')
        revenue=sum(r['amount_cents'] for r in paid)
        cost=None if any(r.get('variable_cost_cents') is None for r in pricing_paid) else sum(r['variable_cost_cents'] for r in pricing_paid)/pricing_units
        # Net revenue per fulfilled unit carries observed refund loss; inventory uses units.
        price=sum(r['amount_cents'] for r in pricing_paid)/pricing_units
        refund_rate=sum(r['amount_cents'] for r in refunds)/revenue if revenue else 0
        weekday=[0.0]*7
        for r in sample: weekday[day(r['business_date']).weekday()]+=r['quantity'] if r['entry_type']=='paid' else 0
        reliable=env['snapshot']['dataNature']=='business' and sum(v>0 for v in weekday)>=4
        weights=[max(0,v)/sum(max(0,x) for x in weekday) for v in weekday] if reliable else [1/7]*7
        result.append(dict(productId=product,skuId=sku,channel=channel,weeklyUnits=qty/4,priceCents=price,unitCostCents=cost,refundRate=min(1,refund_rate),weekdayWeights=weights))
    if not result: raise CalculationError('没有可用历史支付销量；新品不自动外推')
    return weeks,result

def backtest(env,weeks):
    from .backtesting import evaluate_envelope
    result = evaluate_envelope(env,weeks)
    folds = result.pop('folds', [])
    result['foldResults'] = folds
    result['folds'] = len(folds)
    if 'metrics' in result:
        result['wape'] = {k:v['wape'] for k,v in result['metrics'].items()}
        result['bias'] = {k:v['bias'] for k,v in result['metrics'].items()}
        result['aggregateWape'] = {k:v['wape'] for k,v in result['aggregateMetrics'].items()}
        result['actualUnits'] = result['metrics']['fourWeekMean']['actualUnits']
    return result

def evaluate_weekly(weekly,weeks):
    """Same chronological folds and SKU/channel grain as the unit forecast.
    Future-only series have zero predictions and their units remain in the error.
    """
    if len(weeks)<16:return {'status':'insufficient_history','weeks':len(weeks),'minimumWeeks':16}
    if not weekly or any(len(q)!=len(weeks) for q in weekly.values()):raise CalculationError('回测序列长度无效')
    errors={'fourWeekMean':0.0,'lastWeek':0.0};bias=dict.fromkeys(errors,0.0);aggregate=dict.fromkeys(errors,0.0)
    denominator=0.;folds=[];cold_units=0.;series_results={k:{'actualUnits':0.,'errors':dict.fromkeys(errors,0.),'bias':dict.fromkeys(errors,0.),'coldStartUnits':0.} for k in weekly}
    for i in range(8,len(weeks)-3,4):
        actual_totals=[0.]*4;pred_totals={k:[0.]*4 for k in errors};err=dict.fromkeys(errors,0.0);fold_actual=0.
        for key,q in weekly.items():
            detail=series_results[key]
            actual=q[i:i+4];fold_actual+=sum(actual);detail['actualUnits']+=sum(actual)
            if not sum(q[:i]):cold_units+=sum(actual);detail['coldStartUnits']+=sum(actual)
            for h,v in enumerate(actual):actual_totals[h]+=v
            for k,pred in [('fourWeekMean',mean(q[i-4:i])),('lastWeek',q[i-1])]:
                for h,v in enumerate(actual):
                    err[k]+=abs(v-pred);bias[k]+=pred-v;pred_totals[k][h]+=pred;detail['errors'][k]+=abs(v-pred);detail['bias'][k]+=pred-v
        denominator+=fold_actual
        for k in errors:
            errors[k]+=err[k];aggregate[k]+=sum(abs(v-p) for v,p in zip(actual_totals,pred_totals[k]))
        folds.append({'trainEnd':(weeks[i]-timedelta(days=1)).isoformat(),'testStart':weeks[i].isoformat(),'testEnd':(weeks[i+3]+timedelta(days=6)).isoformat(),'actualUnits':fold_actual,'wape':{**{k:v/fold_actual if fold_actual else None for k,v in err.items()},'seasonalNaive':err['lastWeek']/fold_actual if fold_actual else None},'predictedWeeklyUnits':pred_totals,'actualWeeklyUnits':actual_totals})
    return {'status':'evaluated','folds':len(folds),'seriesCount':len(weekly),'sampleStart':folds[0]['testStart'],'sampleEnd':folds[-1]['testEnd'],'horizonWeeks':4,'actualUnits':denominator,'coldStartUnits':cold_units,'wape':{k:v/denominator if denominator else None for k,v in errors.items()},'aggregateWape':{k:v/denominator if denominator else None for k,v in aggregate.items()},'bias':{k:v/denominator if denominator else None for k,v in bias.items()},'foldResults':folds,'seasonalPeriodWeeks':1,'models':{'fourWeekMean':'four-week-mean','seasonalNaive':'seasonal-naive-period-1'},'seriesResults':[{'productId':k[0] if isinstance(k,tuple) else None,'skuId':k[1] if isinstance(k,tuple) else k,'channelId':k[2] if isinstance(k,tuple) else None,'actualUnits':v['actualUnits'],'coldStartUnits':v['coldStartUnits'],'wape':{**{m:e/v['actualUnits'] if v['actualUnits'] else None for m,e in v['errors'].items()},'seasonalNaive':v['errors']['lastWeek']/v['actualUnits'] if v['actualUnits'] else None},'bias':{m:e/v['actualUnits'] if v['actualUnits'] else None for m,e in v['bias'].items()}} for k,v in series_results.items()],'seasonalNaive':{'wape':errors['lastWeek']/denominator if denominator else None,'bias':bias['lastWeek']/denominator if denominator else None},'availabilityAssessment':'retrospective_unless_fold_availability_proven','grain':'SKU/channel × week','meaning':'WAPE 是误差；按相同时间切分比较，合成或公开数据结果不代表本企业经营精度'}

def simulate(env, assumptions=None):
    a=ScenarioAssumptions.model_validate(assumptions or {})
    weeks,groups=prepare(env); s=env['snapshot']; origin=day(s['asOf']); dates=[origin+timedelta(days=i+1) for i in range(28)]
    products=sorted({g['productId'] for g in groups}); skus=sorted({g['skuId'] for g in groups})
    stocks={}; stock_cost={}; warnings=list(s.get('limitations',[])); warnings+=['销量基于已观察销售，不等于潜在需求；不自动推断缺货损失。','情景范围来自假设敏感性，不是置信区间。','销量为支付商品出库件数，净成交额沿用历史退款金额比例；退款返库及成本冲回未建模。','库存资金按已有可售库存账面成本计价；新增到货沿用历史单位成本估算。','按当前快照范围计算；若只选部分渠道，未估计其他渠道对共享库存的占用。']
    if {p['id'] for p in env.get('domain',{}).get('products',[]) if p.get('id')} - set(products): warnings.append('没有历史支付销量的新品未生成数值预测，补充新品需求假设后才能纳入。')
    if s['dataNature']=='demo': warnings.append('SYNTHETIC_DEMO：合成经营事实；日内需求按周均匀分配。')
    for r in s['data']['inventory']:
        key=(r['sku_id'],r['warehouse_id'])
        if key in stocks: raise CalculationError('同 SKU/仓库存在重复库存时点，须先形成唯一快照')
        if not math.isfinite(float(r['sellable_units'])) or r['sellable_units']<0: raise CalculationError('可售库存必须为非负有限数值')
        if r.get('inventory_cost_cents') is not None and (not math.isfinite(float(r['inventory_cost_cents'])) or r['inventory_cost_cents']<0): raise CalculationError('库存账面成本必须为非负有限数值或未知')
        stocks[key]=float(r['sellable_units'])
        stock_cost[key]=r.get('inventory_cost_cents')/r['sellable_units'] if r.get('inventory_cost_cents') is not None and r['sellable_units'] else None
    for sku in skus:
        if not any(k[0]==sku for k in stocks): raise CalculationError(f'{sku} 缺少截至时点库存，不能推演供给约束')
    supply_skus=sorted({k[0] for k in stocks})
    unestimated_skus=sorted(set(supply_skus)-set(skus))
    unestimated_products=sorted(({p['id'] for p in env.get('domain',{}).get('products',[]) if p.get('id')}|{r['product_id'] for r in s['data']['inventory'] if r.get('product_id')})-set(products))
    partial=bool(unestimated_skus or unestimated_products)
    if partial:
        warnings.insert(0,'预测范围不完整：无历史支付销量的 SKU '+('、'.join(unestimated_skus) or '待建立商品/SKU关联')+' 需求未估计，不等于零需求；已知库存和到货保留，期末库存为未扣减这些未知需求的条件结余；贡献毛利暂不计算，不能按局部毛利推荐全范围方案。')
    arrivals=[]
    plans=env.get('domain',{}).get('arrivals',[]); replaced=[r.replacesPlanId for r in a.arrivals if r.replacesPlanId]
    if len(replaced)!=len(set(replaced)): raise CalculationError('同一到货计划不能替换两次')
    for ident in replaced:
        if ident not in {p['id'] for p in plans}: raise CalculationError('待替换的到货计划不存在')
    if len({p['id'] for p in plans})!=len(plans): raise CalculationError('到货计划 ID 重复')
    for p in plans:
        if not math.isfinite(float(p['units'])) or p['units']<0: raise CalculationError('到货件数必须为非负有限数值')
        if p['id'] not in replaced and p['skuId'] in supply_skus: arrivals.append(p)
    for r in a.arrivals:
        if r.skuId not in supply_skus or not origin<r.date<=dates[-1]: raise CalculationError('到货商品或日期不在快照库存范围')
        arrivals.append({'id':'scenario','skuId':r.skuId,'warehouseId':r.warehouseId,'date':r.date.isoformat(),'units':r.units})
    for t in a.transfers:
        if t.skuId not in supply_skus or not origin<t.date<=dates[-1]: raise CalculationError('调拨商品或日期无效')
    if any(r.get('in_transit_units') and not any(p['skuId']==r['sku_id'] for p in plans) for r in s['data']['inventory']): warnings.append('部分在途缺少到货计划，未计入未来可售。')
    for x in a.adjustments:
        if x.productId not in products: raise CalculationError('只支持有历史销量的既有商品')
        if x.channel and x.channel not in {g['channel'] for g in groups if g['productId']==x.productId}: raise CalculationError('商品渠道没有历史依据')
        if x.budgetMultiplier!=1 and x.budgetResponse is None: raise CalculationError('调整投放前须补充预算响应假设')
        if x.priceMultiplier!=1 and x.priceElasticity is None: raise CalculationError('调整价格前须补充价格弹性假设')
    expenses=facts(env,'expenses'); recent=[r for r in expenses if weeks[-4]<=day(r['business_date'])<=weeks[-1]+timedelta(days=6)]
    # Cost allocation is only inferred from explicitly product-attributed expense facts.
    allocated=defaultdict(float)
    for r in recent: allocated[(r.get('product_id'),r['channel'])]+=r['amount_cents']/28
    expense_complete=bool([c for c in s.get('coverage',[]) if c['kind']=='expenses'])
    for source in {c['sourceId'] for c in s.get('coverage',[]) if c['kind']=='expenses'}:
        cursor=weeks[-4]
        for l,r in sorted((day(c['start']),day(c['end'])) for c in s['coverage'] if c['kind']=='expenses' and c['sourceId']==source):
            if l<=cursor<=r:cursor=r+timedelta(days=1)
        expense_complete &= cursor>weeks[-1]+timedelta(days=6)
    if not expense_complete: warnings.append('费用覆盖不足，贡献毛利不可计算。')
    if a.adjustments and any(p is None for p,c in allocated) and any(x.budgetMultiplier!=1 for x in a.adjustments): raise CalculationError('存在未分配到商品的费用，不能执行商品级预算推演')
    def active(product,channel,d):
        found=[x for x in a.adjustments if x.productId==product and (x.channel is None or x.channel==channel) and (x.start is None or x.start<=d) and (x.end is None or d<=x.end)]
        if len(found)>1: raise CalculationError('同商品/渠道/日期有重叠调整，请合并为一组参数')
        return found[0] if found else None
    cost_samples=defaultdict(list)
    for g in groups: cost_samples[g['skuId']].append(g['unitCostCents'])
    costs={k:mean(v) if all(x is not None for x in v) else None for k,v in cost_samples.items()}
    # No sales cost exists for an unestimated SKU. Only its known opening book
    # basis may value arrivals; unknown basis remains unknown, never zero-filled.
    for sku in unestimated_skus:
        keys=[k for k,v in stocks.items() if k[0]==sku and v>0]
        costs[sku]=sum(stocks[k]*stock_cost[k] for k in keys)/sum(stocks[k] for k in keys) if keys and all(stock_cost[k] is not None for k in keys) else None
    if unestimated_skus: warnings.append('无销量历史 SKU 的新增到货沿用已知期初库存单位账面成本作为估值假设；期初单位成本未知时到货估值也未知，不代表采购报价。')
    def add_stock(key,qty,unit_cost):
        old=stocks.get(key,0); old_cost=stock_cost.get(key)
        stock_cost[key]=None if (old>0 and old_cost is None) or (qty>0 and unit_cost is None) else ((old*(old_cost or 0)+qty*(unit_cost or 0))/(old+qty) if old+qty else 0)
        stocks[key]=old+qty
    lines=[{'productId':g['productId'],'skuId':g['skuId'],'channelId':g['channel'],'weekStart':dates[w*7].isoformat(),'weekEnd':dates[w*7+6].isoformat(),'salesBaselineUnits':0.,'fulfillableUnits':0.} for g in groups for w in range(4)]
    features=[]
    for g in groups:
        source=[r for r in env['facts'] if r['kind']=='orders' and r['fact'].get('sku_id')==g['skuId'] and r['fact'].get('channel')==g['channel'] and r['fact']['entry_type']=='paid' and weeks[-4]<=day(r['fact']['business_date'])<=weeks[-1]+timedelta(days=6)]
        stockrows=[r for r in s['data']['inventory'] if r['sku_id']==g['skuId']]
        features.append({'skuId':g['skuId'],'channelId':g['channel'],'asOf':s['asOf'],'lag1Units':sum(r['fact']['quantity'] for r in source if day(r['fact']['business_date'])>=weeks[-1]),'lag4MeanUnits':g['weeklyUnits'],'sellableUnits':sum(r['sellable_units'] for r in stockrows),'knownArrivalUnits':sum(p['units'] for p in plans if p['skuId']==g['skuId'] and origin<day(p['date'])<=dates[-1]),'sourceIds':[r['id'] for r in source],'sourceSnapshots':[{'id':r['id'],'availableAt':r.get('availableAt'),'batchId':r.get('batchId'),'row':r.get('row')} for r in source],'relationSources':[{'typeId':o['typeId'],'objectId':o['id'],'provenance':o.get('provenance',[])} for o in env.get('ontology',{}).get('objects',[]) if o['typeId'] in ('inventory','arrival') and o['properties'].get('skuId')==g['skuId']],'inputRef':env.get('ontologyRef'),'modelVersion':'four-week-mean','featureVersion':'trace-only-v1','availabilityAssessment':'system_recorded' if env.get('ontologyRef') and all(r.get('availableAt') for r in source) else 'retrospective_unknown_availability'})
    days=[]; product_totals={p:{'productId':p,'units':0.,'unmetUnits':0.,'netRevenueCents':0.} for p in products}
    for d in dates:
        for p in arrivals:
            if day(p['date'])==d:
                key=(p['skuId'],p['warehouseId']); add_stock(key,p['units'],costs.get(p['skuId']))
        for t in a.transfers:
            if t.date==d:
                key=(t.skuId,t.fromWarehouse); to=(t.skuId,t.toWarehouse)
                if stocks.get(key,0)+1e-8<t.units: raise CalculationError('调拨超过来源仓可售库存')
                stocks[key]-=t.units; add_stock(to,t.units,stock_cost.get(key))
        demand=[g['weeklyUnits']*g['weekdayWeights'][d.weekday()] for g in groups]
        # Redistribute existing channel demand first. Role changes alone create no demand.
        for channel in sorted({g['channel'] for g in groups}, key=str):
            indices=[i for i,g in enumerate(groups) if g['channel']==channel]
            weights={g['productId']:active(g['productId'],channel,d) for g in groups if g['channel']==channel}
            if any(v and v.mixWeight is not None for v in weights.values()):
                if not all(v and v.mixWeight is not None for v in weights.values()) or abs(sum(v.mixWeight for v in weights.values())-1)>1e-6: raise CalculationError('货盘调整需覆盖该渠道全部商品，权重之和为 1')
                total=sum(demand[i] for i in indices)
                for product,x in weights.items():
                    members=[i for i in indices if groups[i]['productId']==product]; own=sum(demand[i] for i in members)
                    for i in members:demand[i]=total*x.mixWeight*(demand[i]/own if own else 1/len(members))
        wanted=[]; prices=[]
        for i,g in enumerate(groups):
            x=active(g['productId'],g['channel'],d); mul=1
            if x: mul=(x.budgetMultiplier**(x.budgetResponse or 0))*x.conversionMultiplier*(x.priceMultiplier**(x.priceElasticity or 0))
            wanted.append(demand[i]*mul); prices.append(g['priceCents']*(x.priceMultiplier if x else 1))
        sold=[0.0]*len(groups)
        for sku in skus:
            ii=[i for i,g in enumerate(groups) if g['skuId']==sku]; needed=sum(wanted[i] for i in ii); available=sum(v for k,v in stocks.items() if k[0]==sku)
            volume=min(available,needed)
            for i in ii: sold[i]=volume*wanted[i]/needed if needed else 0
            remain=volume
            for k in sorted(stocks):
                if k[0]==sku:
                    take=min(stocks[k],remain); stocks[k]-=take; remain-=take
        spend=0.0
        for (product,channel),value in allocated.items():
            x=active(product,channel,d) if product else None; spend+=value*(x.budgetMultiplier if x else 1)
        for i,g in enumerate(groups):
            line=lines[i*4+(d-dates[0]).days//7];line['salesBaselineUnits']+=wanted[i];line['fulfillableUnits']+=sold[i]
            part=product_totals[g['productId']]; part['units']+=sold[i]; part['unmetUnits']+=wanted[i]-sold[i];part['netRevenueCents']+=sold[i]*prices[i]*(1-g['refundRate'])
        revenue=sum(sold[i]*prices[i]*(1-g['refundRate']) for i,g in enumerate(groups))
        cost=None if any(sold[i]>0 and g['unitCostCents'] is None for i,g in enumerate(groups)) else sum(sold[i]*(g['unitCostCents'] or 0) for i,g in enumerate(groups))
        extra=a.extraCostCents if d==dates[0] else 0
        days.append({'date':d.isoformat(),'units':sum(sold),'unmetUnits':sum(wanted)-sum(sold),'netRevenueCents':cents(revenue),'variableCostCents':cents(cost),'spendCents':cents(spend) if expense_complete else None,'extraCostCents':extra,'contributionMarginCents':cents(revenue-cost-spend-extra) if cost is not None and expense_complete and not partial else None,'endingUnits':sum(stocks.values())})
    def aggregate(ds):
        result={}
        for key in ['units','unmetUnits','netRevenueCents','variableCostCents','spendCents','extraCostCents','contributionMarginCents']:
            result[key]=None if any(r[key] is None for r in ds) else round(sum(r[key] for r in ds),4)
        result['endingUnits']=round(ds[-1]['endingUnits'],4);return result
    totals=aggregate(days)
    totals['endingInventoryCostCents']=None if any(v>0 and stock_cost.get(k) is None for k,v in stocks.items()) else cents(sum(v*(stock_cost.get(k) or 0) for k,v in stocks.items()))
    unknown_keys=[k for k in stocks if k[0] in unestimated_skus]
    coverage={'status':'partial' if partial else 'complete_for_observed_sales','forecastedSkuIds':skus,'unestimatedSkuIds':unestimated_skus,'unestimatedProductIds':unestimated_products,'inventorySkuIds':supply_skus,'salesTotalsScope':'forecasted_skus_only','inventoryTotalsScope':'snapshot_inventory_including_unestimated_demand','endingInventoryMeaning':'conditional_carry_forward_not_full_demand_forecast' if partial else 'conditional_on_sales_assumptions','unestimatedEndingUnits':round(sum(stocks[k] for k in unknown_keys),4),'unestimatedEndingInventoryCostCents':None if any(stocks[k]>0 and stock_cost[k] is None for k in unknown_keys) else cents(sum(stocks[k]*(stock_cost[k] or 0) for k in unknown_keys)),'inventoryValuationComplete':totals['endingInventoryCostCents'] is not None}
    result_scope={'forecastCoverage':coverage}
    return {'calculationVersion':CALCULATION_VERSION,**result_scope,'forecastLines':lines,'featureSnapshots':features,'salesTarget':'paid_item_units','modelVersion':'four-week-mean','salesBaselineUnits':sum(l['salesBaselineUnits'] for l in lines),'fulfillableUnits':sum(l['fulfillableUnits'] for l in lines),'snapshotId':s['id'],'businessId':s['businessId'],'dataNature':s['dataNature'],'inputHash':source_hash(env),'assumptionsHash':source_hash(a.model_dump(mode='json')),'asOf':s['asOf'],'horizonDays':28,'unit':'件','orderCount':None,'intervalMeaning':'assumption_sensitivity_not_confidence_interval','daily':days,'products':[{**p,'units':round(p['units'],4),'unmetUnits':round(p['unmetUnits'],4),'netRevenueCents':cents(p['netRevenueCents'])} for p in product_totals.values()],'endingInventory':[{'skuId':k[0],'warehouseId':k[1],'units':round(v,4),'demandStatus':'unestimated' if k[0] in unestimated_skus else 'forecasted'} for k,v in sorted(stocks.items())],'weeks':[{'start':days[i]['date'],'end':days[i+6]['date'],**aggregate(days[i:i+7])} for i in range(0,28,7)],'totals':totals,'assumptions':a.model_dump(mode='json'),'limitations':list(dict.fromkeys(warnings+['未建立未来每单件数关系，不输出预测客户人数或订单笔数。'])),'backtest':backtest(env,weeks),'evidenceIds':list(s.get('evidenceIds',{}).values())}

def compare(env,assumptions):
    baseline=simulate(env); scenario=simulate(env,assumptions)
    scenario['delta']={k:None if v is None or baseline['totals'].get(k) is None else round(v-baseline['totals'][k],4) for k,v in scenario['totals'].items()}
    # User-provided low/base/high effect assumptions, all with the same origin and stock.
    variants=[]
    for scale in [.5,1,1.5]:
        spec=json.loads(json.dumps(assumptions))
        for x in spec.get('adjustments',[]):
            x['conversionMultiplier']=1+(x.get('conversionMultiplier',1)-1)*scale
            for k in ['budgetResponse','priceElasticity']:
                if x.get(k) is not None: x[k]=max(-5,min(2,x[k]*scale))
        try: variants.append(simulate(env,spec)['totals'])
        except (CalculationError,ValueError): pass
    scenario['sensitivity']={'method':'作用参数相对基准的 0.5/1/1.5 倍；分析假设，非概率区间','totalsRange':{k: [min(v[k] for v in variants),max(v[k] for v in variants)] if variants and all(v[k] is not None for v in variants) else None for k in scenario['totals']}}
    refs=[x.get('assumption',{}) for k in ('adjustments','arrivals','transfers') for x in assumptions.get(k,[])]+([assumptions['extraCostAssumption']] if assumptions.get('extraCostAssumption') else [])
    if any(x.get('source')=='model_hypothesis' for x in refs):
        scenario['feasibility']={'status':'unconfirmed','reasons':['AI 提出的需求响应或供给条件尚未核对，不能据此认定最优方案']}
        scenario['limitations'].append('AI 作用参数仅作为条件推演假设；计算差额不证明行动收益。')
    return scenario


def evaluate_forecast(env,forecast):
    """Paid units observed in a later fixed snapshot; no new training model."""
    weeks=series(env);benchmark=backtest(env,weeks)
    lines=forecast.get('forecastLines',[])
    if not lines:return {'status':'legacy_detail_unavailable','benchmark':benchmark,'minimumWeeks':16}
    coverage=env['snapshot'].get('coverage',[]);rows=facts(env,'orders');observations=[]
    for line in lines:
        start=day(line['weekStart']);end=day(line['weekEnd']);complete=bool([c for c in coverage if c['kind']=='orders']) and end<=day(env['snapshot']['asOf'])
        for source in {c['sourceId'] for c in coverage if c['kind']=='orders'}:
            cursor=start
            for a,b in sorted((day(c['start']),day(c['end'])) for c in coverage if c['kind']=='orders' and c['sourceId']==source):
                if a<=cursor<=b:cursor=b+timedelta(days=1)
            complete &= cursor>end
        actual=sum(r['quantity'] for r in rows if r['entry_type']=='paid' and r.get('sku_id')==line['skuId'] and r.get('channel')==line['channelId'] and start<=day(r['business_date'])<=end) if complete else None
        observations.append({**line,'actualUnits':actual,'coverage':'complete' if complete else 'incomplete'})
    covered=[l for l in observations if l['actualUnits'] is not None];den=sum(l['actualUnits'] for l in covered)
    scores={k:{'wape':sum(abs(l[k]-l['actualUnits']) for l in covered)/den if den else None,'bias':sum(l[k]-l['actualUnits'] for l in covered)/den if den else None} for k in ['salesBaselineUnits','fulfillableUnits']}
    return {'status':benchmark['status'] if benchmark['status']!='evaluated' else 'evaluated' if len(covered)==len(lines) else 'insufficient_coverage','observationStatus':'complete' if len(covered)==len(lines) else 'insufficient_coverage','minimumWeeks':16,'actualUnits':den,'scores':scores,'observations':observations,'coverageGaps':[{'skuId':l['skuId'],'channelId':l['channelId'],'weekStart':l['weekStart']} for l in observations if l['actualUnits'] is None],'benchmark':benchmark,'actualSnapshotId':env['snapshot']['id'],'actualAsOf':env['snapshot']['asOf'],'actualInputRef':env.get('ontologyRef'),'forecastInputRef':forecast.get('ontologyRef'),'availabilityAssessment':'retrospective_unless_fold_availability_proven','target':'paid_item_units','meaning':'支付件数；零实际销量 WAPE 为空，不能推断潜在需求或宣称精度提升'}

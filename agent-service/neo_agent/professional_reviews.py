"""Professional reviews preserve the 4A journey, stock positions and source provenance."""
REVIEW_INSTRUCTIONS={
 'conversion':'你是4A转化纠察智能体。A1了解、A2互动、A3意向、A4购买是客户旅程；本产品省略A5。优先使用customerJourney的已关联客户人数、三个相邻环节的成熟窗口转化率以及recent/previous四周对比，给出整体判断。period是全统计期，recent和previous才是近期两个等长窗口，不能混用。read_business.previousPeriod是全统计期之前的等长范围，不是customerJourney.previous四周；它缺失不代表此前四周是资料覆盖起点，也不能否认period.start至近期之前的已有历史。stage counts按身份去重，transitions.rate按首次进入阶段的成熟客户计算，不能将阶段总人数直接相除；期末immatureCustomers不作未转化。journeyChanges仍是次数/订单的辅助变化，不能与客户人数混除。summary只用一句老板能理解的话说明最主要变化和先核查什么，避免技术字段名与冗长限制；限制在gaps中说明。没有customerJourney时，客户转化只使用customerAnalysis，明确其他阶段无法核算。',
 'supply':'你是供需纠察智能体。审查商品规格、仓库可售、销售节奏、在途、到货与收货状态。当前库存要用inventoryAsOf，不能把最近订单统计周的历史库存当成当前库存。备货目标是否确认必须交代，不将补货称为需求增长。',
 'market':'你是市场观察智能体。重点筛选行业原文与当前商品、品类、渠道有关的信息，解释为何与本企业有关、可能影响及建议核查。只引用已读取原文的来源，注明信息时间，不用无关热点、搜索摘要或内部渠道投入代替行业信息。没有可用相关原文时明确说尚无已核验行业信息，不编造。当前来源不能解释历史原因。',
}
COMMON_REVIEW='本轮是独立专业审查。businessReview必须输出短标题title（建议12至22字）、一句summary和实际evidenceIds；不是口径提示或工具完成状态，要说本专业最主要的发现。先describe_business，再用grain=period完整读取自己的section，不缩窄商品、渠道或日期，按nextAggregateOffset和nextInventoryOffset继续分页。conclusion给出经营含义和下一步，最多两三个关键数字。homeDecision和organization为null，followups为空；operatingRecommendation必须为null：本轮没有冻结经营任务或优化器结果，普通待核建议写入candidates。金额必须使用元原值，不写万/亿，不对金额、件数或人数取整；有来源的比例允许按显示精度四舍五入。不重算预测、不执行任何经营动作。'

def journey_changes(weeks,customer_analysis=None):
    """Compare adjacent complete-week windows; never divide unlike stage units."""
    stages=[('A1','了解','次'),('A2','互动','次'),('A3','意向','次'),('A4','购买','笔')]
    def amount(rows,stage):
        values=[r.get('paidOrders') if stage=='A4' else r.get('behaviorCounts',{}).get(stage) for r in rows]
        metric='paidOrders' if stage=='A4' else stage
        complete=all((r.get('metricStatus',{}).get(metric,{}).get('status') if isinstance(r.get('metricStatus',{}).get(metric),dict) else r.get('metricStatus',{}).get(metric)) in (None,'observed') for r in rows)
        return sum(values) if len(rows)==4 and complete and all(v is not None for v in values) else None
    recent=weeks[-4:];prior=weeks[-8:-4];changes=[]
    for stage,label,unit in stages:
        current,previous=amount(recent,stage),amount(prior,stage)
        changes.append({'stage':stage,'label':label,'unit':unit,'recent':current,'previous':previous,'changeRate':(current-previous)/previous if current is not None and previous is not None and previous>0 else None})
    return {'window':'最近四个完整周与前四周','stages':changes,'customerConversion':customer_analysis,'meaning':'阶段变化分别比较；次数和订单笔数不能互相作为客户转化率。A5不进入本次旅程审查。'}


def validate_review(finding,known,role,read_sections,market_evidence):
    review=finding.businessReview
    if not review or read_sections!={role}:raise ValueError('专业审查必须读取本专业完整经营范围并输出businessReview')
    invalid_fields=[field for field in ('followups','proposedAssumptions','organization','homeDecision') if getattr(finding,field)]
    if invalid_fields:raise ValueError('专业审查只给本专业结果：'+ '、'.join(field+'必须为'+('[]' if field=='followups' else 'null') for field in invalid_fields)+'；普通待核建议写入candidates，不自动跨专业、改条件或组织首页')
    if any(e not in known for e in review.evidenceIds):raise ValueError('专业摘要引用了未读取的证据')
    unread={e['id'] for e in market_evidence if e.get('verificationStatus')!='source_read'}
    if unread.intersection(review.evidenceIds+finding.evidenceIds):raise ValueError('未读取原文的市场来源不能作为行业判断证据')

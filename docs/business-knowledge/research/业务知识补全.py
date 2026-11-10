from pathlib import Path
import json, csv
OUT=Path(__file__).resolve().parent
data=json.loads((OUT/'成熟实践与补全项.json').read_text())
S={s['id']:s for s in data['sources']}
# ID, relationship, rule, fields, must-confirm, scope, sources.
ROWS=[
('K01','企业→来源→业务主键','对象键由企业、资料性质、来源命名空间和外部ID决定；同外部ID跨来源可能不是同对象。','businessId,dataNature,sourceNamespace,externalId,canonicalId','跨来源订单和客户的可靠匹配方法','全部','S01,S07'),
('K02','客户↔外部身份','多个身份可指向一客户；一外部身份在同一有效时点应只指一客户，姓名相同不能作为自动合并依据。','customerId,identityNamespace,externalId,effectiveFrom,effectiveTo,availableAt','共享账号、家庭账户、误合并后的拆分处理','客户','S07,S04'),
('K03','客户→事件→订单','聚合事件数量不能还原独立客户；可识别事件与订单在可信身份映射后才进入同群转化。','eventId,contactId,orderId,occurredAt,productId,channelId','匿名覆盖比例、订单身份缺失如何标partial','客户','S07,S08'),
('K04','订单→明细→SKU','一订单可有多明细、同明细多件；订单笔数、明细数、件数、客户数四种指标不可互换。','orderId,lineId,skuId,quantity,customerId','组合装、赠品、套装拆分及企业订单','销售','S09,S03'),
('K05','漏斗步骤→同群体','依首次进入起点形成队列，后续阶段按顺序在固定观察窗完成；未成熟客户不是失败客户。','cohortStage,entryTime,windowDays,orderedSteps,asOf','起点A1/A2/A3、是否严格有序、观察窗长短','客户','S08'),
('K06','漏斗↔渠道和商品','同渠道转化与跨渠道转化是两种问题；漏斗各步过滤规则须保持可解释，不能任意换分母。','channelPolicy,productPolicy,stepFilters,attributionPolicy','跨商品成交是否计入该商品转化','客户/渠道','S08'),
('K07','支付→退款→净留存客户','支付转化与最终保留购买不同。发生过支付的客户不会因后续退款自动从支付历史消失。','paidAt,refundAt,refundAmount,fullyRefunded,observationWindow','全退款是否排除、截至时点及新客/老客口径','客户/退款','S09,S08'),
('K08','A5→复购/评价/推荐','复购、评价、推荐分开度量；统一归到A5是产品分类，不能因此认为都是同一种忠诚或获客。','repeatOrderId,reviewEvent,referralId,cohortId','复购窗口、推荐是否需验证新客成交','客户','S26,S08'),
('K09','上游事件→成交滞后','不同业务的咨询至支付时长不同；旧原型固定滞后一周不应变成通用经营规律。','eventAt,paidAt,conversionLagDistribution','观察期与行业周期，是否有时间完整的身份链','客户/预测','S08,S14'),
('K10','支付→履约/出库','paid证明支付记录，不能独立证明实物出库；支付件数预测和履约需求预测需单独命名。','paymentId,paidAt,fulfillmentId,shippedAt,shippedQuantity','预售、延迟发货、拆单和取消是否影响预测目标','销售/库存','S09,S10'),
('K11','销售额→退款→净成交','当前NEO净成交是同期支付金额减同期退款金额；不是自动等同税务收入、Shopify净销售或现金到账。','amountCents,discount,tax,shipping,refundAt,settlementAt','amount是否含税、运费、折扣；采用哪一经营口径','金额','S09'),
('K12','净成交→成本→广告→贡献','本项目贡献口径为净成交减变动成本减广告费用；未包含的固定费用和成本使其不能称净利润。','variableCostCents,spendCents,costCoverage,allocationRule','平台佣金/履约费是否已含成本，是否存在重复扣减','金额','S09,S03'),
('K13','退款金额↔退货件数↔返库','退款可无退货、退货可未退款，返库还取决于验收和是否可售；三个量不可绑成必然同步。','refundType,refundAmount,returnedUnits,restockedSellableUnits','主模板quantity>0需兼容金额型退款，破损如何计价','退款/库存','S09,S10'),
('K14','费用→渠道/商品分摊','费用有成交、触点、成本三种关联；未归属商品的费用不能忽略后称该商品完整贡献。','costChannel,campaignId,productId,allocatedAmount,allocationVersion','采用直接关联还是已确认分摊；余项如何保留','费用','S03,S12'),
('K15','SKU→仓库→库存观测','库存是状态而非流水；按SKU×仓库取时点最新可用观测，不能把连续多天库存相加。','skuId,warehouseId,observedAt,availableAt,state,units','盘点与系统库存不一致时优先级和新鲜度要求','库存','S10,S04'),
('K16','在库→可售/承诺占用/不可售','可售不含在途；输入可售若已扣占用，推演不能再扣同一占用一次。','onHand,available,committed,reserved,damaged,incoming','源系统的sellable定义及安全库存是否已预留','库存','S10'),
('K17','渠道↔共享仓库库存','两个渠道可以竞争同一SKU库存；筛一个渠道时不能假定其他渠道不占用库存。','skuId,warehouseId,channelAllocation,reservations,priority','分配规则、共享/专属库存、其他渠道占用量','库存/渠道','S10,S01'),
('K18','到货计划→实际收货→可售','ETA是计划，收货是事实，质检后才可能可售；取消和改ETA应留版本，不能把计划当已收货。','planId,status,plannedEta,receivedAt,acceptedUnits,knownAt','运输、采购、收货、质检的提前期与状态转移','供给','S10,S11'),
('K19','仓间调拨→数量/成本守恒','同批调拨减少源仓、增加目的仓，总件数不凭空增加；运输中另有在途状态与费用。','transferId,sourceWarehouse,destWarehouse,units,cost,receivedAt','起运与入库是否跨日，损耗及费用归属','供给','S10'),
('K20','备货目标→安全库存/Min-Max','人工目标和统计安全库存不同；先维护目标、提前期和来源，数据充分后再估需求波动。','minimumUnits,maximumUnits,leadTime,serviceLevel,ruleVersion','实际服务水平、MOQ/包装倍数、采购与资金约束','供给','S11'),
('K21','货盘角色→达标分子/分母','按SKU还是SKU×仓评价必须先定；跨仓同SKU若按SKU口径只能计一次；无观测不是零库存。','roleId,eligibleSkuIds,threshold,observedCoverage,ruleEffectiveFrom','新SKU是否进入分母，角色多重归属及货盘目标','供给','S03,S10'),
('K22','历史销量→潜在需求/缺货','缺货可能截断销量，替代品销量也可能上升；零销量不能直接解释为零需求。','stockoutAt,lostDemandAttempt,substituteSku,availabilityHistory','有没有缺货时段或尝试购买数据；不能无证据恢复需求','预测/供给','S28'),
('K23','广告归因→增量成交','归因回答触点如何获得记账贡献，增量回答没有广告时会不会发生；ROAS与iROAS分开。','attributionWindow,exposure,controlAssignment,incrementalValue','试点对照设计、足够样本、转换滞后和观察范围','渠道/情景','S12,S22'),
('K24','价格/促销→销量/商品替代','价格变化需固定规格和净价；短期增长可能是跨商品替代或提前购买，不能一项增加就算企业净增加。','netPrice,promoPeriod,comparableSku,otherSkuSales,postPeriod','本企业价格弹性、促销后期、库存/费用和交叉替代','情景','S13,S29'),
('K25','外部事件→日期/适用范围','发布日、发生日和抓取日不同；能读原文只证明取得资料，事实及适用性仍须核查。','eventDate,publishedAt,retrievedAt,region,entity,quoteLocation,status','政策/价格事件生效日、来源可靠性及是否重复转载','市场','S23,S13'),
('K26','指标同期变化→因果假说','渠道热度、促销、销量与库存可能共同受季节等影响；外部变化应先形成假说与反证。','candidateCause,temporalOrder,confounders,alternatives,testPlan','哪些变量影响投放决策、是否控制了中介变量','市场/诊断','S13'),
('K27','业务发生时间↔系统可知时间','当时可知的未来计划可用，当时未知的历史资料不能加入当时回测；源历史时间不能替代系统入库时间。','effectiveFrom,effectiveTo,occurredAt,availableAt,asOf,knownAt','客户提供的历史知悉记录能否核验；没有时只能事件日回放','数据/回测','S04,S14'),
('K28','预测→情景→选择→实际结果','点预测、假设范围、概率区间、老板选择、实际观察五类记录分开；比较固定输入与计算版本。','forecastId,scenarioId,decisionId,inputHash,calculationVersion,actualWindow','作用参数证据与观察设计，保存选择不意味着执行','决策','S14,S15,S22'),
('K29','酒店预订→入住日×房型房晚','预订日决定何时收到消息，入住日决定库存到期；pickup、取消、未到店、维修停用房需分别记录。','bookedAt,stayDate,roomType,onBooks,pickup,cancellations,outOfOrder','售房与入住分母、ADR收入范围、渠道佣金与房晚成本','酒店原型；非当前零售主线','S24,S25'),
('K30','画廊作品→所有权/寄售→成交','作品可为单件或限量版；保管位置不等于所有权；寄售全成交额与画廊佣金收入不可直接混同。','artworkId,edition,ownerId,consignmentContract,location,commissionRule','合同与收入口径需业务材料确认；此项为行业适配假设','画廊旧原型；未建立真实业务规则','S01,S09'),
]
items=[dict(id=r[0],relationship=r[1],rule=r[2],fields=r[3].split(','),must_confirm=r[4],scope=r[5],sources=r[6].split(','),status='知识补全建议；商户规则仍需确认') for r in ROWS]
(OUT/'业务关系与规则.json').write_text(json.dumps(dict(date='2026-10-04',items=items),ensure_ascii=False,indent=2)+'\n')
with (OUT/'业务关系与规则.csv').open('w',encoding='utf-8-sig',newline='') as f:
    cols=['id','relationship','rule','fields','must_confirm','scope','sources','status']; w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
    for item in items:w.writerow({**item,'fields':','.join(item['fields']),'sources':';'.join(S[i]['url'] for i in item['sources'])})
parts=['\n## 业务知识反补：30条关系与规则\n\n以下是补入项目研究资料的业务知识条目，不是已写入生产数据库的规则。通用定义可以直接采用；目标值、观察窗、利润口径和来源映射仍需对应商户确认。字段名是推荐语义，不能据此认定当前接口都支持。\n\n|编号与业务关系|补回的规则|建议资料字段|仍需确认|依据|\n|---|---|---|---|---|\n']
for item in items:
    src='；'.join(f"[{i}]({S[i]['url']})" for i in item['sources'])
    parts.append(f"|{item['id']} {item['relationship']}|{item['rule']}|{', '.join(item['fields'])}|{item['must_confirm']}；适用：{item['scope']}|{src}|\n")
(OUT/'业务知识正文.md').write_text(''.join(parts))
print(json.dumps({'business_rules':len(items)},ensure_ascii=False))

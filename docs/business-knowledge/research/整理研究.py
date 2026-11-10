from pathlib import Path
import json, csv

OUT=Path(__file__).resolve().parent
ROOT=Path(__file__).resolve().parents[3]
MAIN=ROOT

# Summaries are paraphrases. Documentation proves a described mechanism, not market share.
SOURCE_ROWS=[
('S01','Palantir Ontology','https://www.palantir.com/docs/foundry/ontology/overview','业务对象、属性、关系、函数与应用共同组织业务语义。','正文读取','官方产品文档'),
('S02','Palantir Action types','https://www.palantir.com/docs/foundry/action-types/overview/index.html','Action 将对象、属性和关系变更组织为事务，带参数、规则及提交条件。','搜索返回原文','官方产品文档'),
('S03','dbt Semantic Layer','https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl?version=2','集中定义指标，供下游工具一致使用，避免多处重复计算口径。','搜索返回原文','官方产品文档'),
('S04','dbt Snapshots','https://docs.getdbt.com/docs/build/snapshots','通过 SCD Type 2 保留可变源表的历史状态；这种历史保存本身不等于完整双时态。','正文及关键段落读取','官方产品文档'),
('S05','Great Expectations 数据质量','https://docs.greatexpectations.io/docs/reference/learn/data_quality_use_cases/dq_use_cases_lp/','质量维度包括结构、缺失、唯一性、有效性、完整关系、新鲜度、数量和分布。','搜索返回原文','官方项目文档'),
('S06','阿里云 DataWorks 质量规则','https://help.aliyun.com/zh/dataworks/developer-reference/data-quality-spec-configuration-guide/','以声明式规则、期望阈值和 warn/fail 结果组织数据质量，可保存问题数据。','搜索返回原文','官方产品文档'),
('S07','PostHog 身份识别','https://posthog.com/docs/data/anonymous-vs-identified-events','同一 distinct ID 会合并为同一人，ID碰撞和通用占位ID会造成错误合并。','搜索返回原文','官方产品文档'),
('S08','PostHog Funnels','https://posthog.com/docs/product-analytics/funnels','漏斗明确步骤、转换窗口、首次发生规则和归因选择；未完成观察期影响趋势。','搜索返回原文；独立open失败','官方产品文档'),
('S09','Shopify Sales reports','https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report','销量、销售额、销售冲回、实体退货和支付不是同一概念；销售报表不是资金到账报表。','正文读取并核读搜索原文','官方产品文档'),
('S10','Shopify Inventory states','https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps','区分可售、承诺占用、保留、质检、损坏和在途；在途收货前不能当可售。','正文读取并核读搜索原文','官方技术文档'),
('S11','Odoo 补货规则（17.0）','https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html','补货用最小/最大数量与采购提前期、需求日期等约束；阈值依产品设置。','搜索返回原文；独立open超时','官方版本文档；不是最新版本核验'),
('S12','Google Ads 归因与增量','https://support.google.com/google-ads/answer/14102450?hl=en-AU','归因转化与对照实验中的增量转化不同，普通ROAS与增量ROAS不同。','搜索返回原文','官方产品文档'),
('S13','Google Meridian 控制变量','https://developers.google.com/meridian/docs/advanced-modeling/control-variables','因果评估需处理混杂并谨慎对待中介变量，预测拟合改进不保证因果估计改进。','正文及关键段落读取','官方方法文档'),
('S14','FPP3 时间序列交叉验证','https://otexts.com/fpp3/tscv.html','滚动预测起点只用测试时点之前的训练资料，按目标预测步长评价。','搜索返回原文','作者公开教材'),
('S15','FPP3 预测区间','https://otexts.com/fpp3/prediction-intervals.html','点预测之外需要未来结果分布与预测区间；误差分布与假设决定区间解释。','正文读取','作者公开教材'),
('S16','LangGraph Persistence','https://docs.langchain.com/oss/python/langgraph/persistence','Checkpointer 保存会话图状态，Store 保存跨会话资料；持久化支持继续和故障恢复。','正文读取','官方技术文档'),
('S17','Stripe Idempotent requests','https://docs.stripe.com/api/idempotent_requests?api-version=2025-12-15.preview','幂等键重放已有结果；相同键但不同参数应报错；保存和清理条件须明确。','搜索返回原文','官方API文档；参考其机制'),
('S18','OpenLineage Object Model','https://openlineage.io/docs/spec/object-model/','区分任务定义、运行和数据集；设计血缘与实际运行事件不同。','正文及关键段落读取','官方开放规范'),
('S19','OpenTelemetry Traces','https://opentelemetry.io/docs/concepts/signals/traces/','Trace/Span 可以连接跨服务操作，异步工作可通过 Span Links 关联。','正文及关键段落读取','官方开放规范'),
('S20','Cloudflare D1 Limits','https://developers.cloudflare.com/d1/platform/limits/','数据库、单行、SQL及请求存在明确容量限制；Time Travel 免费7天、付费30天。','正文及限制表读取','官方平台文档；2026-04-21更新'),
('S21','Cloudflare D1 Time Travel','https://developers.cloudflare.com/d1/reference/time-travel/','托管D1提供时间点恢复机制，其适用范围与计划限制需结合Limits确认。','搜索返回原文','官方平台文档'),
('S22','GrowthBook Experiment Results','https://docs.growthbook.io/app/experiment-results','实验结果区分基线/变体、目标与护栏指标，并检查样本分配异常。','正文及SRM段落读取','官方产品文档'),
('S23','Google Trends 数据定义','https://support.google.com/trends/answer/4365533?hl=en','趋势为采样并标准化的搜索兴趣指数；0可能是数据不足，不是绝对需求量。','正文读取','官方产品文档'),
('S24','Oracle OPERA Forecast reports','https://docs.oracle.com/cd/E81346_01/doc.183/e81527/c_reports_forecast.htm','房型、在手预订、预订节奏和日期级房晚构成酒店预测资料。','搜索返回原文','官方历史版本文档；仅参考语义'),
('S25','STR 酒店指标定义','https://str.com/sites/default/files/us_hotel_forecast_review_sample.pdf','ADR、入住率、RevPAR采用不同的房晚分母和客房收入定义。','搜索返回PDF原文','指标原定义；历史样本非当前市场数据'),
('S26','PostHog Retention','https://posthog.com/docs/product-analytics/retention','按进入时期分群衡量后续行为，独立客户计数与群组口径须明确。','搜索返回原文','官方产品文档'),
('S27','OWASP Authorization','https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html','身份验证与资源授权不同；最小权限、默认拒绝与逐请求授权。','正文读取','官方项目指南'),
('S28','缺货条件下的需求估计研究','https://pubsonline.informs.org/doi/10.1287/msom.2015.0520','缺货限制可观察销量，销量不是完整需求；库存记录不准使需求识别进一步受限。','搜索返回原论文摘要','2015年原始研究；仅核读摘要'),
('S29','促销增长分解研究','https://pubsonline.informs.org/doi/pdf/10.1287/mksc.1040.0061','促销短期增长可以包含跨商品替代、跨期购买提前和品类扩张；单期增加不直接代表净增量。','搜索返回原论文摘要','2004年原始研究；仅核读摘要'),
]
S={x[0]:dict(id=x[0],title=x[1],url=x[2],supported_claim=x[3],access=x[4],kind=x[5],grade='A',checked_on='2026-10-04',caveat='公开文档证明机制存在，不证明本项目已实现或供应商客户效果') for x in SOURCE_ROWS}
def cite(ids): return '；'.join(f"[{i} {S[i]['title']}]({S[i]['url']})" for i in ids.split(','))

# ID, title, current evidence, mature pattern, NEO proposal, acceptance, priority, source IDs, code paths.
ROWS=[
('R01','产品定位与首页','原/demo为主界面；母文档还包含更广远期设想。','用统一事实与指标组织业务应用。','首页收敛为一个待决定问题、关键数、受影响范围和下一核查；其他议题进入详情。','同一快照下首页与专业页数字一致，空数据不生成经营结论。','P1','S01,S03','components/neo-demo/prototype.tsx;docs/NEO_商业增长智能体_产品框架与阶段总览.md'),
('R02','身份与企业隔离','主项目已有成员校验；旧/api/data已返回410。','每个资源请求独立授权。','延续businessId+成员授权，正式身份、原件下载、证据及子资源都走同一校验。','跨企业快照/对象/原件/方案ID均拒绝；部署身份另行验收。','P0','S27','server/auth.ts;server/api.ts;app/api/data/route.ts'),
('R03','权限与数据性质','admin/importer/reader；demo/business隔离已有契约。','最小权限与显式写操作。','记录操作类别与操作者，LLM只读工具继续受限；编辑定义、提交导入与保存选择分别校验。','reader不能写，模拟输入不能借改标签进入真实经营结论。','P0','S27,S02','server/auth.ts;server/contracts.ts;server/ontology/operations.ts'),
('R04','导入模板与映射','主项目四类CSV模板；v2接入契约在隔离副本。','声明式规则和固定结构减少隐含假设。','版本化模板包含单位、日期、唯一键、业务对象引用、覆盖声明；通用导入映射到原看板需独立桥接。','客户/角色/到货资料正常提交后在原页面出数；后台存在对象不算通过。','P0','S06,S03','server/templates.ts;server/csv.ts;server/ingestion.ts'),
('R05','去重、修订、幂等','事实键和内容Hash、批次Hash已持久化。','重复请求回读同一结果，键复用参数不一致拒绝。','区分文件重复、同业务记录重复、主数据新版本和订单修订；跨来源重复订单需映射表。','重叠批次不加倍，同键内容变化有冲突或修订路径；超时后先回读。','P0','S17,S04','db/schema.ts;server/ingestion.ts;server/ontology/operations.ts'),
('R06','主数据和关系校验','默认Ontology缺客户类型；主投影读取4类领域资料；v2已描述客户、仓库等。','业务对象与关系有稳定键和约束。','校验企业+性质+有效时点内SKU→商品、订单→客户、库存→仓库；引用对象只提示缺主档。','错商品SKU、跨企业引用、有效期外引用不能进入可信指标。','P0','S01,S05','server/ontology/model.ts;server/ontology/project.ts;server/csv.ts'),
('R07','质量状态与缺失','已区分null/0、行级问题和partial；完整度仍依赖覆盖声明。','多维质量规则配套warn/fail与问题资料。','增加来源登记、预期更新日、缺报周期、关联完整率；质量状态附指标范围。','缺报、真实零、无定义、缺身份分别显示；质量修复影响新快照而非旧原件。','P0','S05,S06','server/contracts.ts;server/ingestion.ts;server/snapshots.ts'),
('R08','时点和有效版本','Ontology冻结asOf/knownAt；主经营快照契约尚未统一knownAt；v2规划双时点。','可变对象历史状态应保留。','同时保存业务发生/有效时间与实际系统可知时间；晚到历史只能生成新版本。','未来或迟到记录不进入当时预测；历史回读不混入新商品角色或新ETA。','P0','S04,S14','server/snapshots.ts;server/ontology/store.ts;server/ontology/project.ts'),
('R09','范围和可比周期','已有范围组件和快照路由；不能以它们的存在认定全页联测通过。','统一指标定义和维度。','企业/商品/渠道/期间/快照为同一上下文；环比同时限定完整度和规则版本。','切换范围后卡片、图、对话、周报、证据共同变化；前期缺失不显示增长率。','P0','S03','components/neo-demo/operating-scope.tsx;components/neo-demo/operating-context.tsx'),
('R10','指标字典','公式分散在快照、适配、Python和历史growth-data。','集中指标语义，供人和工具共享。','定义metricId、粒度、分子/分母、单位、时间、缺失策略、版本和证据查询；沿用现栈。','同指标在UI/Agent/周报一致；区分支付订单数、支付件数、客户人数。','P0','S03','server/snapshots.ts;lib/operating-demo-data.ts;agent-service/neo_agent/business_tools.py'),
('R11','净成交、成本和贡献','主公式为同期支付−同期退款；贡献减成本和广告；不是净利润。','销售、支付与到账分开，净销售有明确扣减项。','保留现口径并说明amount是否含税运费折扣；成本缺失时贡献为null；不自动改成会计收入。','手算跨期退款、成本缺失、未分摊费用、零值；界面名称与公式相符。','P0','S09','server/snapshots.ts;server/contracts.ts;agent-service/neo_agent/engine.py'),
('R12','退款、实体退货和返库','主模板退款quantity要求正整数；引擎未建退款返库。','资金退款与实物返回可独立发生。','扩展金额型退款、退货/验收/可售返库事件及原订单关联；金额/成本/数量分别回转。','只有金额退款不扣实物，破损退货不加可售，跨期退款保留发生日。','P0','S09,S10','server/csv.ts;server/ingestion.ts;agent-service/neo_agent/engine.py'),
('R13','客户身份与订单关联','主events可含contact_id，主订单模板缺客户字段；隔离v2已有映射。','身份ID稳定且防止误合并。','Customer+CustomerIdentity，以企业/来源命名空间/externalId映射匿名键；订单必须关联规范客户才能做客户漏斗。','同人跨来源映射后去重，两人同显示名不合并；缺身份只报覆盖不足。','P0','S07','server/templates.ts;server/contracts.ts;server/ontology/model.ts'),
('R14','客户漏斗与同群转化','主页面行为量次与订单笔分开；最新v2规定身份或来源覆盖不足时partial/null，单渠道拒绝any策略。','漏斗依据有序步骤、同一主体与转换窗口。','复用v2队列契约；窗口成熟后算转化，缺身份/覆盖为null，渠道锁定与跨周规则配置化。','重复咨询/多次下单只计一人；未到期者不算失败；单渠道不猜跨渠道转化，不取不同群体阶段量相除。','P0','S08','server/snapshots.ts;lib/operating-demo-data.ts;components/neo-demo/prototype.tsx'),
('R15','成交渠道与营销归因','目前channel连接订单、事件、费用，缺触点历史。','漏斗归因可选首/末触点，归因不等于因果增量。','区分成交渠道、触点渠道和成本渠道；初期显示同范围经营效率，跨渠道贡献待触点资料。','一单多触点不重复汇总企业收入；缺触点不猜来源。','P1','S08,S12','server/contracts.ts;server/snapshots.ts;lib/operating-domain-data.ts'),
('R16','5A与复购/推荐','review/referral/repeat_purchase都映射A5；这不能证明推荐意愿。','留存/回访依行为定义与进入时期分群。','保留5A为解释框架；复购客户、推荐行为、评价分开展示，不预置行业转化阈值。','同人两笔订单与同单多明细区分；评价不自动成为新获客或高忠诚。','P1','S26,S08','server/templates.ts;lib/growth-data.ts;lib/neo-core.ts'),
('R17','商品、SKU和货盘角色','有商品/SKU/角色主资料，角色可在SKU或商品层。','实体与关系为业务含义服务。','角色明确用途和有效期；若一个SKU同时引流和利润，可新增角色关联记录及配置主角色。','按历史时点角色看历史，SKU跨仓不重复计入SKU分母。','P1','S01,S04','lib/operating-domain-data.ts;server/ontology/model.ts;db/schema.ts'),
('R18','当前/历史库存','取SKU×仓库截至前最新观测，历史达标仍需定义。','库存状态分层；观测日期影响可用性。','记录快照观测与导入时点、覆盖仓库和新鲜度；按时点取值不累计历史库存。','历史周按当时记录计算；迟到观测不污染已保存旧版本。','P0','S10,S04','server/snapshots.ts;lib/operating-domain-data.ts'),
('R19','可售、占用与在途','主模板只有可售、在途、安全线及库存成本。','可售/占用/保留/质检/在途不同状态。','先固化输入sellable是否已扣占用；在途凭到货/收货状态进入未来可售，禁止二次扣减。','同一计划不同时作为在途及新到货加两次；冻结/破损库存不销售。','P0','S10','server/templates.ts;agent-service/neo_agent/engine.py;lib/operating-domain-data.ts'),
('R20','安全库存与补货目标','存在人工safety_units；适配称目标待确认；隔离v2有供给规则。','按产品设Min/Max及提前期约束。','先用商户确认目标和采购/入库提前期；统计安全库存等数据积累后再估。','阈值变化有版本；无阈值不画达标线；缺货与资金占用同时比较。','P1','S11','lib/operating-domain-data.ts;server/templates.ts;agent-service/neo_agent/contracts.py'),
('R21','覆盖天数、缺货与未满足需求','主coverageDays用近4周支付量/28；引擎unmet为模型假设下缺口。','缺货会截断可观察销量，供给与潜在需求需分清。','标为按观察销量估算的覆盖天数；缺货抑制需求时补缺货时段/缺货尝试/替代行为。','零销量不等于无限覆盖；不能将未满足模拟需求直接写成已损失收入。','P1','S28,S11','lib/operating-domain-data.ts;agent-service/neo_agent/engine.py'),
('R22','到货、采购与调拨','引擎支持ETA和调拨，现计划未完整含采购、收货、质检链。','在途收到后才可售；补货考虑提前期。','Arrival关联采购/调拨/收货，区分计划ETA与实际收货；取消/变更增版本，仓间守恒。','到货延期影响缺口；源仓超量拒绝；新品无销量仍保留已知库存。','P0','S10,S11','agent-service/neo_agent/engine.py;server/ontology/model.ts'),
('R23','货盘供给达标','当前SKU数与角色库存存在；隔离线提出唯一SKU分母及规则。','定义指标先固定粒度、分母与目标。','写明跨仓汇总SKU或仓库SKU口径；合格SKU数/应评价SKU数，与事前角色目标比较。','同SKU两个仓不变成两SKU；缺观测为覆盖不足，不能判全库存不达标。','P1','S03,S10','lib/operating-domain-data.ts;components/neo-demo/charts.tsx'),
('R24','渠道×角色矩阵','现展示observed/记录；尚无通用状态判定契约。','指标状态由确定规则和证据支持。','每个单元同商品角色/渠道/期间，记录量、效率、样本与质量；不足时unknown。','点某单元返回局部事实；阈值版本在详情，不能把有记录涂成健康。','P1','S03,S05','lib/operating-domain-data.ts;server/scoped-evidence.ts;components/neo-demo/prototype.tsx'),
('R25','市场来源、时间和声明','已有publishedAt/retrievedAt/历史可用标记、正文读取检查。','外部指标及资料有自身采样和口径限制。','市场事件保存发生日、发布日期、抓取日、适用地区/商品、原文位置、冲突来源与审核状态。','旧政策新抓取不能列为新变化；转发不能算独立证实；缺发布日期不用于历史回测。','P1','S23,S13','agent-service/neo_agent/providers.py;server/agent-contracts.ts;server/agents.ts'),
('R26','竞品价格和需求信号','原演示有事件；真实竞品的可比SKU/价格状态仍需资料。','搜索兴趣是相对指标，不能代替成交需求。','分开挂牌/券后/实际成交价；统一规格、币种、地区、渠道、有效日；用至少两次观察判断变价。','不同规格不直接比价；单条降价消息不推出市场萎缩；指数不转成销量。','P1','S23,S09','components/neo-demo/today-briefing.tsx;server/agent-contracts.ts'),
('R27','市场变化与内部原因','专业输出已有alternatives/gaps及无因果提醒。','混杂、中介和时间顺序决定因果解释。','区分已观察变化/解释假说/可验证信号；列库存、价格、投放和季节等竞争解释。','同期订单下降+竞品促销仅提出假说；工具未计算损失不得模型手算。','P1','S13,S12','agent-service/neo_agent/agent.py;agent-service/neo_agent/providers.py'),
('R28','Ontology定义与业务投影','16种17关系、自由类型与REFERENCE_ONLY；主默认定义缺客户闭环。','实体、属性、关系与Action统一业务操作。','保留固定NEO配置；补客户身份、触点及真实库存关系按闭环扩展；定义发布做兼容性判断。','新定义不使旧投影失读；引用占位不伪造主数据；导入客户后真正生成客户关系。','P1','S01,S02','server/ontology/model.ts;server/ontology/project.ts;db/ontology-schema.ts'),
('R29','对象集、关联与聚合','单跳查询/count/sum已实现；预测不支持任意对象子集。','统一语义层避免关联后错误聚合。','查询声明输入/输出粒度和关系基数；重用已实现分页，不将后台筛选误当预测筛选。','多对多展开不能重复收入；空集与缺属性分开；不支持预测子集明确拒绝。','P1','S01,S03','server/ontology/model.ts;agent-service/neo_agent/ontology.py'),
('R30','人工编辑和来源冲突','有source/override/review及并发版本校验。','受控Action以规则约束事务变更。','人工覆盖保留理由、有效期和原值；源更新触发review，不默默永久覆盖事实。','过期版本409；源更新和人工更改都可追溯；编辑原件不被改写。','P1','S02,S04','server/ontology/operations.ts;server/ontology/project.ts'),
('R31','预测目标和基线','主引擎28天、近4完整周均值；回测含均值与上周；v1.1在隔离线。','按滚动起点和业务步长评价。','明确目标为支付件数还是履约件数；只用可知资料，均值/上周/合理季节对照同切分。','不给支付记录自动贴实际出库；每个cutoff只读取当时可得特征。','P0','S14','agent-service/neo_agent/engine.py;agent-service/neo_agent/contracts.py'),
('R32','回测、误差和模型晋级','主16周门槛；监督已独立检查隔离样本，但未证明真实效果。','训练/测试按时间隔离，多步误差按目标。','同时报WAPE/MAE/bias、SKU及总量误差、冷启动和缺货区段；16周是本项目最低门槛。','未来销量变化不改变旧预测；WAPE不写准确率；稳定胜出才采用挑战者。','P0','S14','agent-service/neo_agent/engine.py;agent-service/tests/test_engine.py'),
('R33','概率区间和敏感性','主引擎已明确assumption_sensitivity_not_confidence_interval。','预测区间来自未来分布，不是随意低中高范围。','先保持假设范围名称；积累真实误差后校准分位区间，分期限报覆盖与宽度。','P10-P90的目标覆盖为80%而非90%；短期和远期分别核验，缺样本不标已校准。','P1','S15','agent-service/neo_agent/engine.py;components/neo-demo/charts.tsx'),
('R34','投放/价格/转化的作用参数','预算响应和价格弹性要求显式假设；未校准本企业效应。','因果参数不能凭预测拟合或归因替代。','保存参数source/note/evidence/范围/有效期；用小试点或合适对照估计，合成只验链路。','外部弹性不可直接视为本企业真值；加投放不固定同比例增单；不重复扣成本。','P0','S13,S12,S22','server/agent-contracts.ts;agent-service/neo_agent/contracts.py;agent-service/neo_agent/engine.py'),
('R35','基线、情景和老板选择','有artifact、parentId和历史范围函数；回读适配已有代码。','对照比较固定同一基准；幂等保存。','比较绑定企业/性质/快照/输入Hash/计算版本/基线ID；选择只记理由与待验证条件。','跨版本或跨基线不混比；刷新重开读出原选择；损坏单条不拖垮全页。','P0','S22,S17','lib/decision-history.ts;server/decision-readback.ts;server/agents.ts;server/ontology/operations.ts'),
('R36','周报与决策反馈','两种决策读取路径已新增适配；今日文档曾记录崩溃，现不能据旧记录断言仍复现。','比较数据、统计证据与判定分开。','周报列本周事实、调查、方案、已保存选择、未验证条件；实际结果另记录观察窗/执行证据。','混合普通/Ontology记录可读；未执行不写收益，观察结果不自动作为行动因果收益。','P0','S22,S12','components/neo-demo/weekly-report.tsx;components/neo-demo/live-agents.tsx;server/decision-readback.ts'),
('R37','专业职责和综合研判','三专业+joint/orchestrator，已有结构输出与专业读工具。','统一状态保存与同一指标语义。','转化看同群客户，供需看库存/履约，市场看来源/可比变化；综合只汇总分歧与核查优先级。','各结论能由本专业证据重建；三个重复全企业总结不算专业完成。','P1','S16,S03','agent-service/neo_agent/agent.py;lib/agent-missions.ts;server/agents.ts'),
('R38','业务查询工具与引用','主已有产品/渠道/分周读取；隔离可靠性线增加完整聚合。','固定语义查询可减少LLM猜指标。','工具返回范围、单位、总量/样本、分页与证据；引用存在之外检查其支持当前声明。','片段20行不能冒充总量；每个局部数对应局部证据；读取失败不生成带证据断言。','P0','S03,S18','agent-service/neo_agent/business_tools.py;agent-service/neo_agent/ontology.py;server/scoped-evidence.ts'),
('R39','队列优先级、领取与取消','主SQLite worker；隔离线已有租约、优先级等交接，自报待独立验收。','持久化状态与执行轨迹支持恢复。','优先整合可靠性线已有方案；显式领取/心跳/租约/旧worker隔离，交互优先巡检。','两个worker不能重复处理；取消后旧worker不得写完成；恢复保留部分成果。','P1','S16,S19','agent-service/neo_agent/app.py;agent-service/neo_agent/patrol.py'),
('R40','恢复与外部调用重放','已有checkpoint；主节点恢复仍需避免重复外部调用；副本已做调用级日志。','图状态持久化和请求幂等互补。','外部调用保存输入Hash/状态/响应；已完成复用，状态不明先对账，禁止声称exactly-once。','断网/进程中断/401/402/429分别处理；未知结果不盲目重新收费或重复副作用。','P1','S16,S17','agent-service/neo_agent/app.py;agent-service/neo_agent/providers.py'),
('R41','巡检触发和新鲜度','主保存快照会登记巡检；隔离样本使用测试守卫，可靠性线补产品开关。','运行状态区别于任务定义。','触发键包含快照/范围/规则版本，显式开关和交互优先级；先数据质量再经营异常。','默认隔离验收不外呼；相同输入不重复；缺资料仅产生缺口，不形成伪经营告警。','P1','S18,S16','server/agents.ts;agent-service/neo_agent/patrol.py'),
('R42','模型服务、来源及成本','主记录usage，已有超时重试；隔离线RunBudget和响应重放自报。','调用轨迹和受限重试可定位问题。','单任务设工具/搜索/token/时间边界；usage缺失记未知，不记零；费用由实际模型价格版本换算。','402不反复重试；429退避；预算超限保留部分结论；真实调用小样本另验。','P1','S19,S17','agent-service/neo_agent/providers.py;agent-service/neo_agent/agent.py;server/agent-contracts.ts'),
('R43','运行观测与血缘','已有步骤、运行、输入Hash、source与Ontology图。','定义血缘和运行血缘分开；跨服务Trace关联。','统一correlationId：导入→快照→投影→调查→计算→选择；显示实际成功读/写。','能从错误结论找输入版本和失败工具；连线存在不标运行成功。','P1','S18,S19','server/ontology/api.ts;server/ontology/operations.ts;agent-service/neo_agent/app.py'),
('R44','运行容量、迁移、恢复','D1/R2/Drizzle；项目还有1MiB/1000行/10000事实等自身限制。','托管存储有容量与恢复窗口。','保留现栈；按项目限制先验证分页/增量/异步，再扩大；备份覆盖D1、R2原件、Python任务/检查点。','迁移先备份；各存储恢复后Hash/版本/引用完整；托管D1备份不当成本地全系统恢复。','P1','S20,S21,S16','db/schema.ts;scripts/setup-local.mjs;server/runtime.ts;agent-service/neo_agent/app.py'),
('R45','合成数据、公开基准与真商户','8周主样例，24周新隔离资料与独立oracle；副本自报不是最终主线验收。','质量规则与时间回测需要独立期望。','复用已有24周正常/反例包，手算oracle独立于产品；正式导入后再导出预测输入。','身份/金额/守恒/时点反例验证；不从实际结果反填期望，不把合成误差写真实精度。','P0','S05,S14','scripts/prepare-agent-demo.py;tests/ingestion.test.mjs'),
('R46','测试和整合证据','现有Node/Python/构建/渲染；多个工作线成果尚有整合前置条件。','运行事实和设计说明区别明确。','复用有效证据，按业务闭环做少量关键反例和原/demo联测；版本变化失效对应旧证据。','确认正式导入→客户/库存→调查→预测→选择→刷新回读；构建不替代经营验收。','P0','S18,S22','tests/ontology.test.mjs;tests/agents.test.mjs;tests/rendered-html.test.mjs;agent-service/tests/test_engine.py'),
('R47','老板表达、证据抽屉和图表','已有business-presentation和局部证据函数；手机/全页业务效果本轮未重验。','指标可下钻范围与分子分母。','标题经营现象、原因待核、下一步一项；证据附范围、公式、日期、来源与限制；统一日期/元/分/件。','点击M1只看M1；同周点只看同周；缺数据与0可辨；键盘和手机另做相关验证。','P1','S03,S22','lib/business-presentation.ts;components/neo-demo/evidence-drawer.tsx;components/neo-demo/charts.tsx;server/scoped-evidence.ts'),
('R48','历史文档、基线与工作线','README和台账保存旧状态；本轮读到的新代码已包含若干旧缺口修复。','任务/数据/运行元信息各有版本。','汇总按源码存在/开发自报/独立验收/真实经营验证四档；并行副本逐差异整合。','不能把旧未实现当今天未实现，也不能把副本实现当主线已上线。','P1','S18','README.md;docs/NEO-经营表达与功能验收.md'),
('R49','酒店场景','neo-v2/hotel为合成原型，不纳入主/demo成熟度。','OPERA按入住日期和房型整理预订/库存/节奏；STR指标分母明确。','酒店另定义预订日×入住日×房型、在手/新增/取消/未到店、房晚与渠道成本；只复用数据和版本底板。','未来房晚不能用商品支付件数引擎直接推；过期房晚不能调拨到后天。','P2','S24,S25','lib/hotel-demo.ts;app/neo-v2/hotel/page.tsx;docs/hotel-product-plan.md'),
('R50','画廊/通用增长旧原型','growth-data/neo-core保存5A与规则预测，非主经营结果的统一口径。','实体关系与指标语义需匹配场景。','作品按单件/版次、所有权/寄售与位置建模；佣金口径、收藏者身份等须由业务资料确认。','作品销售不直接用零售销售额当画廊收入；无业务资料不自动迁移行业模板。','P2','S01,S09','lib/growth-data.ts;lib/neo-core.ts;app/neo-v2/core/page.tsx'),
]
items=[]
for row in ROWS:
    i,t,cur,pattern,proposal,accept,priority,src,paths=row
    items.append(dict(id=i,title=t,current=cur,mature_pattern=pattern,proposal=proposal,acceptance=accept,priority=priority,sources=src.split(','),code_paths=[str(MAIN/p) for p in paths.split(';')],status='研究建议；未实施或重做业务验收'))
(OUT/'成熟实践与补全项.json').write_text(json.dumps(dict(as_of='2026-10-04',sources=list(S.values()),items=items),ensure_ascii=False,indent=2)+'\n')
with (OUT/'成熟实践与补全项.csv').open('w',encoding='utf-8-sig',newline='') as f:
    cols=['id','title','priority','current','mature_pattern','proposal','acceptance','sources','code_paths','status']
    w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
    for item in items:
        w.writerow({**item,'sources':';'.join(S[i]['url'] for i in item['sources']),'code_paths':';'.join(item['code_paths'])})

sections=[('一、产品、接入与统一口径',0,12),('二、客户与人货场业务关系',12,24),('三、市场、Ontology与业务变更',24,30),('四、预测、情景与老板决策',30,36),('五、智能体、可靠性与交付',36,48),('六、既有行业原型的适配边界',48,50)]
blocks=[]
for title,start,end in sections:
    blocks.append('\n## '+title+'\n')
    for item in items[start:end]:
        file_links='；'.join(f'[{Path(p).relative_to(MAIN)}]({p})' for p in item['code_paths'])
        blocks.append(f"\n### {item['id']} · {item['title']}（{item['priority']}）\n\n**项目位置：** {file_links}。\n\n**当前证据：** {item['current']}\n\n**成熟做法：** {item['mature_pattern']} {cite(','.join(item['sources']))}。\n\n**补入NEO的建议：** {item['proposal']}\n\n**验收结果应是：** {item['acceptance']}\n")
blocks.append('\n## 来源核验登记\n\n均于2026-10-04查询。A代表一手定义/文档；产品文档中的机制是供应商公开声明，未在供应商产品内实操，也未核验市场份额、商户成功率或完整商业条款。\n\n|编号|来源与直接链接|实际支持的结论|访问及日期边界|\n|---|---|---|---|\n')
for s in S.values(): blocks.append(f"|{s['id']}|[{s['title']}]({s['url']})|{s['supported_claim']}|{s['access']}；{s['kind']}|\n")
(OUT/'模块研究正文.md').write_text(''.join(blocks))
print(json.dumps({'modules':len(items),'sources':len(S),'missing_code_paths':[p for item in items for p in item['code_paths'] if not Path(p).is_file()]},ensure_ascii=False))

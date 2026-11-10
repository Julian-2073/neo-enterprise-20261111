# NEO 预测优化：实施与验收记录

更新日期：2026-10-08。最新经营大脑与 AutoGluon 实施以[追加交付记录](./forecast-operating-brain-implementation-2026-10-08.md)为准；下文保留前一阶段验收证据。对应[完整方案](./forecast-enterprise-plan-2026-10-08.md)。已交付电商/零售 SKU×渠道预测的本地核心闭环：支付口径、独立训练任务、六种方法竞争、叶子区间校准、假设版本、约束方案、经营选择和成熟实际评估。制造与酒店继续沿用原行业适配。

用户确认暂时没有真实企业数据。本次验证使用独立 `dataNature=demo` 资料和程序 fixture，不能证明真实企业预测精度。原方案的全部生产能力尚未完成；下面明确列出已实现的行为和剩余范围。

## 已实现的模型与检验

正式经营代次仍保存预先确定的四周支付均值；候选模型独立保存，不自动覆盖原结果。退款另计金额，不抵消已支付件数；历史缺货、停业和上架时间未识别，目标是支付销量，不是全部潜在需求。

| 方法 | 实际实现 |
|---|---|
| 四周均值、上周重复、四周同星期均值 | 三个可复现基线，共用冻结矩阵 |
| AutoETS | StatsForecast 实际拟合，周季节长度7 |
| CrostonSBA | StatsForecast 实际拟合，提供间歇销量候选 |
| MLForecast＋LightGBM | 跨序列树模型；滞后1/7/14/28、移位滚动7/28、星期/月、SKU与渠道编码；固定seed、CPU单线程 |

训练矩阵使用已有 as-of 规范化器：记录修订、知识时间、封存导入组、渠道归属和覆盖声明共用同一规则。候选训练要求每条序列至少84天完整历史，首轮最多64条序列、7或28天预测。缺资料不补成零；被高级模型排除的短历史/新品继续保留为未估计范围。

完整历史最多形成11个非重叠标签窗口，按时间先后分成2个内部选择、3个独立校准、6个外层测试。训练窗口可以重叠，标签窗口不重叠。内部选择不读取外层误差；外层失败不能反过来改变内部冠军。当前拟合失败回退到均值，外层失败或门槛不足保留原基线。

历史在起点之后导入时，按当时资料的窗口会跳过。用户可以明确选择“历史重建”，用于当前历史研究；该模式始终不能作为过去当时可用或真实前瞻的证明。7天完整窗口约需161天历史，28天完整窗口约需392天历史，还须满足真实可见时间与标签成熟条件。

统计适配参考 [StatsForecast 官方模型文档](https://nixtlaverse.nixtla.io/statsforecast/src/core/models.html)；特征和检验路径参照 [MLForecast 官方交叉检验](https://nixtlaverse.nixtla.io/mlforecast/docs/how-to-guides/cross_validation.html)。本项目的选择/校准/外层分离由自己的冻结矩阵控制，没有把库的单次验证成绩直接当成企业精度。

## 区间、经验情景与验收门槛

独立校准窗达到3个时，按SKU×渠道汇集绝对残差，使用有限样本修正秩构造名义80%的非负叶子区间。外层另报实测覆盖、平均宽度、interval score，并与同窗口均值基线的区间比较。均值点值不冒充中位数，WIS保留未报告。时间序列残差并不自动满足可交换性，因此“已校准”仅说明校准程序完成，不能保证未来覆盖。

校准残差按完整窗口共同抽取32条路径，保留已观察的SKU之间和时间相关性，再进入库存、在途、履约和费用约束，给出可履约的经验最小/最大范围。它不是校准后的联合概率区间，不能将叶子区间相加，也不输出缺货概率。专家分布另报条件范围；追加阶段已实现声明秩关联下的联合条件样本，尚未形成经过联合概率检验的分布。

离线影子资格要求：至少6个外层窗、4个胜出窗；WAPE相对有效均值基线改善至少10%；绝对Bias不超过5%；各叶子分组误差不得恶化超过5%；名义80%区间实测覆盖在75%–85%；区间宽度和interval score不能相对基线恶化超过5%。任何缺项都不能晋级。

真实精度状态按同企业、资料性质、模型代码、序列范围和期限累计已保存的成熟发布周期。7天与28天不混计，同周期修订和重叠周期不重复计数。最近三个独立周期必须通过WAPE、偏差、叶子SKU MAE保护与区间覆盖；近期恶化产生 `needs_review`。演示资料、历史重建、发布后的回顾性结果、缺历史门槛或不足三个周期都显示未通过。

这里只提供验收状态与人工经营选择，不自动激活候选模型为正式基线。生产模型切换、按分组选择冠军、正式模型自动回退和覆盖稳定性的长周期统计验收仍待实现。

## 假设台账与方案闭环

假设版本保存企业、经营代次、前一版本、作者、修订理由、来源及得知时间、有效期。支持导入事实、专家参数、事件概率、均匀范围和真正参与计算的公式。事实节点必须由同一冻结资料的数值与时间证明；专家判断不能标成事实。公式只支持受限运算树，验证依赖存在、循环和单位；没有到销量节点的依赖只作旁注。

界面可保存固定/范围销量条件、事件概率和事件发生时的影响，形成“基础比例＋事件×影响”的明确条件公式。它不证明因果关系。没有明确分开的相关性组时，专家不确定节点共享抽样，不默认全部独立。应用期限必须覆盖预测期，样本与方案叠加不能超出允许范围。

事件必须定义问题、概率、带时区的未来结算时间及可核对规则。到期后关联之后得知的本企业实际记录，拒绝未封存、被更新或计划/取消的凭据，保存人工登记结果和Brier评分。关联凭据并不自动证明事件语义，因此结果明确标为 `human_declared_with_evidence`。

每份方案保留模型任务、假设版本、原条件和约束结果，人工经营选择保留这些引用。旧方案能回读；资料或假设更新后显示需重算。数据库写入也检查经营代次和最新假设，防止计算或保存期间发生变化。原均值方案与高级模型方案不会混成同一口径自动排名。保存选择不执行采购、派单或其他外部动作。

成熟后分别保存原预测评估与可选假设FVA；修订MAE/WAPE改善只表示误差变化。预测期之后创建的假设标为回顾性修订，不能算前瞻改进或经营动作收益。原预测和旧选择保持不变。

## 运行、存储与页面

独立 Python 计算环境为 `agent-service/.forecast-venv`，实际安装 StatsForecast 2.1.1、MLForecast 1.1.0、LightGBM 4.6.0。主聊天 `.venv` 不装这些数值依赖；完整版本冻结在 `forecast-requirements.lock`。

计算服务使用持久化SQLite队列与单独CPU子进程，不调用LLM或市场服务。稳定请求幂等，支持排队、取消、预算和重启中断；取消后晚结果不能发布。单次计算预算30–600秒，页面默认180秒，排队等待另计；最多16个待运行任务。当前约束是单服务进程、单训练任务，不是分布式生产队列。

D1新增 `neo_forecast_jobs`，迁移为 `drizzle/0018_perfect_maddog.sql`，已生成、检查并在隔离环境应用。冻结矩阵、模型结果、假设、方案和评估复用D1/R2资料保存机制。实际训练模型文件按SHA-256校验后登记到R2，保存参数、数据范围、代码指纹与依赖。服务控制令牌使用请求头，产品响应和URL不返回令牌；摘要不复制逐日预测或32条路径。

原 `/demo` “生意预测/协同”保留“经营联动 / 预测与检验 / 方案与决策”。预测页新增“模型检验与假设协同”：7/28天、当时资料/历史重建、运行/取消、模型与窗口详情、真实精度状态、假设修订/结算、按SKU每日点值与区间图/逐日明细、候选方案、版本回读和经营选择。原基线及制造/酒店展示保持兼容。

主要新增文件：`lib/forecast-enterprise.ts`、`lib/forecast-assumptions.ts`、`server/forecast-enterprise.ts`、`server/forecast-assumptions.ts`、`agent-service/neo_agent/forecast_compute.py`、`forecast_jobs.py`、`components/neo-demo/forecast-enterprise-panel.tsx`。原方案/决策/兼容投影作对应接入。

```text
GET/POST /api/v1/business-forecast-jobs
POST     /api/v1/business-forecast-jobs/{id}/sync | cancel | evaluate
GET      /api/v1/business-forecast-jobs/{id}/points?entityId=...&channelId=...
GET      /api/v1/business-forecast-quality/{id}
GET/POST /api/v1/business-assumptions
POST     /api/v1/business-assumptions/settle
GET/POST /api/v1/business-scenarios
GET/POST /api/v1/business-decisions
```

所有产品请求带 `businessId` 和 `dataNature`；读列表带 `generationId`。创建模型任务使用 `{requestId,generationId,horizonDays,domain,budgetSeconds}`；创建方案可显式引用 `{forecastJobId,assumptionSetId}`。读取不触发昂贵训练。同步、计算和保存检查写权限，经营选择检查管理员身份。

## 实际验证与预览

| 检查 | 当前证据 |
|---|---|
| 相关Node回归 | 31项通过：时点/修订/覆盖、六模型API全链路、取消、鉴权、D1/R2、FVA、假设冲突/过期、经营约束、原预测渲染、制造/酒店、Ontology与引用 |
| 最终页面复验 | 最后展示与评估按钮调整后，3项SSR渲染通过 |
| 实际CPU模型 | 4项通过；六种方法实际运行、模型文件、3个校准窗、6个外层窗、32条路径；外层标签及失败不影响内部选择 |
| 原智能体与预测回归 | 67项Python通过；原队列、智能体、时点回测和预测闭环保持兼容 |
| 计算队列 | 2项通过；幂等/冲突、跨企业拒绝、取消后晚完成无效、重启中断 |
| 编译检查 | TypeScript、受影响文件ESLint、完整稳定构建通过；有既有Vinext动态导入/依赖体积警告，无新阻断错误 |
| 浏览器 | 隔离页面运行模型、另存假设、生成约束方案；服务重启及页面重载后回读模型、假设和方案；SKU切换与28天逐日值、事件规则修订、旧方案需更新/禁止采用、新方案与经营选择、未成熟实际及回顾性FVA均已回读，捕获的console error为0 |

最终源码及预览指纹：`3e794822d7e40a87e1446687f4ff3d1ed4cb55bacf7f0b383b54bf4eb33d6d8d`，已从运行入口核对一致。

[最终页面截图](../outputs/forecast-enterprise-phase2/forecast-panel.png)；[SKU区间图截图](../outputs/forecast-enterprise-phase2/forecast-daily.png)；[浏览器回读记录](../outputs/forecast-enterprise-phase2/browser-verification.json)。

日志目录：`outputs/forecast-enterprise-phase2/`。本次模型API验证使用448天独立fixture，不能作为模型在真实企业上的改善证明。先前十万事实检查保留为口径生成链路的历史证据，不代表本次64序列训练的并发或生产SLO。

[本地隔离预览](http://127.0.0.1:3124/demo?page=overview&businessId=test-a&dataNature=demo&view=forecast)。目录是 `outputs/forecast-enterprise/preview`，全部使用合成资料，原运行数据库未触碰，LLM和市场调用关闭。此页面历史只有224天、晚导入：28天候选有2个选择窗和3个校准窗，没有外层窗，因此外层误差不可计算、真实企业验收未通过。候选支付1,232件、可履约1,052件；10%专家条件方案可履约1,133件，均为演示程序结果。随后保存第二版“基础10%＋50%事件概率×10%影响”条件，可履约1,174件、专家条件范围1,133–1,214件，并保存人工选择；旧版1,133件方案标明需要更新。

重新启动：

```sh
NEO_LOCAL_OUTPUT=outputs/forecast-enterprise/preview NEO_WEB_PORT=3124 NEO_AGENT_PORT=8144 NEO_EXECUTION_MODE=offline node scripts/start-local-stable.mjs
```

新机器先建立独立预测环境，再用锁定版本安装：

```sh
agent-service/.venv/bin/python -m venv agent-service/.forecast-venv
agent-service/.forecast-venv/bin/python -m pip install -r agent-service/forecast-requirements.lock
npm run build:local:stable
```

生产部署未执行。仓库已有大量用户未提交改动保留；未提交Git。第一切片备份位于 `/tmp/neo-forecast-before-20261008-123331`，本次开始时diff另存 `outputs/forecast-enterprise-phase2/before/preexisting.patch`；只用于逐处对照，不应整文件覆盖之后的用户改动。

## 仍待完成的完整方案范围

1. **真实企业验收**：没有真实资料；需冻结企业/SKU/渠道范围，审计销量、价格、活动、缺货及知识时间，然后形成至少三个真实成熟前瞻周期。历史销售CSV的事后导入不能倒填时间成为过去发布预测。
2. **数据与模型扩展**：活动/价格/广告的可见时间契约与特征接入；缺货截断识别、新品冷启动、真实分组冠军与动态模型回退。AutoGluon适配已在追加阶段启用并实际验证；Chronos 权重训练及其它隔离挑战者仍未启用。
3. **概率与经营完善**：更充分的校准/覆盖稳定性验收、统一统计与专家联合分布、聚合层概率一致性、经验证缺货概率与业务收益/成本评估。
4. **前端与生产扩展**：全量SKU分页和异常排序、经营分歧区、智能体引用当前模型/假设、正式模型激活与回退、自动周期检验和大规模队列/SLO。目前是可运行的本地网页与预测试点能力。

核心链路可以继续使用与测试，以上范围没有被合成演示“验收通过”代替。

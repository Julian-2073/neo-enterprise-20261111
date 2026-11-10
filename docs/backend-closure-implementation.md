# NEO 后端经营闭环实施记录

## 可恢复基线

- 备份：`/Users/majun/Desktop/NEO/backups/20261007-043131`。
- 基线提交：`299793e24b4174c66e15283b89af147cba9bf764`。
- 标签：`neo-pre-optimization-20261007-043131`；实施分支：`optimize/neo-backend-closure`。
- 工作区归档逐文件校验 2,024 项；51 个 SQLite 完整性检查通过。Git bundle 独立恢复及原 demo 哈希通过。
- 凭证只在受限本地备份；不提交 Git、不推远端。恢复步骤见备份目录的 RESTORE.md。

## 目标与进度

|目标|状态|当前证据与剩余工作|
|---|---|---|
|G1 统一指标、对账|已实现并验证|版本化指标、完整性、批次对账、更正、历史回读；现有工作台与研判绑定同一代次。覆盖仍是提供方声明。|
|G2 自动更新|已实现并验证|持久更新事件、封存发布、依赖失效、租约恢复、配置更新；AI 自动运行仍由服务器权限控制。|
|G3 三行业供给|已实现并验证|仓库/渠道/交期约束、逐日房晚、单层 BOM 与共享工序日产能；六企业 API 案例通过。|
|G4 可行方案|已实现并验证|同代次候选比较与贡献毛利推荐；未知成本、预算或约束不推荐，追加投入预算不冒充完整现金流。|
|G5 执行复盘|已实现并验证|选择→实际凭据→执行→原窗口实际对照；浏览器合成收货/实际数据复盘通过，不运行企业动作。|
|G6 AI 业务质量|已实现并验证|冻结事实和引用校验、行业语义、有限修复及调用账本；三行业 v1.7 正式模型运行与针对性业务检查通过。|
|G7 多行业接入|已实现并验证|统一 JSON/CSV、旧导入及已证明客户身份兼容；行业各两家合成企业无需专属代码。未连接生产 PMS/ERP/MES。|
|G8 本地交付|已实现并验证|受限完整备份、代码/DB独立恢复、十万条 HTTP 接入、公平队列、构建指纹与隔离本地运行。|

## 第一阶段接口

- `GET/POST /api/v1/business-profile`：版本化企业档案，写入要求 admin、同源与 baseVersion；已有资料不能直接更换行业经营单位。
- `GET /api/v1/business-inputs`：类型、格式及批次限制。
- `POST /api/v1/business-inputs`：JSON records 或 CSV + metadata；声明来源、完整覆盖类型、预期条数及可选总量；更正须引用 supersedesId。原始事实追加保留。
- `GET /api/v1/business-state`：asOf/start/end/knownAt；返回指标、完整性、来源、版本与冻结输入。knownAt 不可倒填事实可用性。
- `GET /api/v1/business-updates`、`business-generations`：已登记更新事件与代次。

所有接口使用现有企业权限与 demo/business 隔离；资料完整性目前仍来自提供方声明，不冒充独立业务核实。

## 实施边界

保留原 demo 所有代码。沿用 D1/Drizzle 与 Python 服务，不连接真实 PMS/ERP/MES、不部署生产、不自动采购/投放/生产。酒店按入住日房晚、电商按 SKU/仓库、制造按单层 BOM 和单工序日产能适配。合成案例验证方法，不证明真实企业 ROI。

## 基础检查点验证

Node 自动发现回归 290 项、构建后的原 demo HTML 检查 20 项、Python 财务与既有研判回归 33 项通过。类型检查、完整构建及原 demo 文件哈希通过。新增档案校验追加 3 项 API 回归通过。此检查点是可信接入基础，不表示八项目标完成。

## 第二个检查点：自动代次与约束闭环基础

新接入和档案发布后自动进行确定性计算；本地稳定启动加入公平轮转更新 worker，租约过期可恢复；不在读取页面时调用付费模型。平台配置发布对有新企业档案的状态触发更新；旧接入完整编排尚未接通。

business-scenarios 比较、business-decisions 保存、business-executions 登记和 business-outcomes 复盘均绑定企业/资料性质/冻结代次。履约规则 costCents 是额外履约费用；方案 action costCents 是额外动作费用。按历史单位收入和已确认单位成本估计，不推断价格弹性。

Node 全量 296 项通过；随后新增/受影响回归 10 项与既有配置/研判 14 项通过；类型检查、完整构建及原 demo HTML 20 项通过。此阶段不能作为完整企业交付，剩余目标见上表。

## 第三个检查点：事实绑定研判与大资料存储

新增 business-reviews 的显式生成与只读回读，沿用持久队列、调用账本和图检查点。专业停用配置生效，联合研判读取已完成专业判断。新会话通过 generation_id 外键关联经营代次，旧 snapshot_id 与历史会话保留；迁移已修正新列复制为 NULL，禁止把新代次伪装成旧经营快照。

完整经营代次超过 D1 行大小时使用 R2 保存，并校验大小、SHA256、企业和资料性质；API 仅返回摘要。原始 JSON/CSV 保留实际输入字节。十万条记录测试验证确定性汇总、供给约束、完整资料回读及隔离；该性能数据直接写入，不代表十万条 HTTP 上传吞吐验收。统计窗口取已发布配置，库存观察时间不由未来计划推进。

Node 全量 299 项、Python 全量 234 项、类型检查和完整构建通过；原 demo 文件哈希一致。离线模型用受控适配器，不冒充在线模型验收。原路由模型选择补足缺失 envelope 时的默认配置读取，修复既有全量测试失败。

## 第四阶段：接入、页面与在线研判闭环

已增加分片接入封存：最多 100 个分片，每片 1,000 条/1 MiB；未封存资料不进入当前状态，也不提前推进库存观察日。封存必须核对全批行数、数量及金额；同一封存事件驱动持久计算。十万条真实 HTTP 接入已验收，100 个分片约 196 秒，独立期望值与后台收入、订单和库存约束结果一致。它是当前本地环境的观察值，不是生产吞吐 SLA。

旧 CSV 提交在已发布经营档案内进入同一更新队列。旧订单可显式更正，冻结时点仍保留旧值。客户身份仅由同企业、已提交、业务日期有效的客户主数据/映射证明；身份修订进入代次失效键，不能把联系人字段直接当已识别客户。

已删除另建的 components/business-closure/workbench.tsx 与 CSS，以及 OperatingProvider 的替换分支。所有企业继续使用既有 /demo 工作台、组件、主导航和交互。后端通过 workbench-compat 与 workbench-projection 将统一经营代次投影到现有 operating-snapshot、home-sections、customer-journey、market-workbench、decision-workbench、forecasts/scenarios/decisions、agent-runs 和 evidence 接口；不另设前端页面。新代次默认自动读取，显式旧 snapshotId 继续使用原链路；generationId 可以回读历史。读取不会新建付费模型任务。未归属渠道费用使渠道费用和毛利保持不完整，禁止任意分摊。mode=example 的保护文件未改动。

后台任务使用独立后台执行槽和交互槽，并保留旧全局运行锁兼容；专业停用配置与服务器自动巡检权限仍生效。专业判断和联合研判共享事实、约束、已读原文和调用账本。每次最多八个模型调用，校验失败最多修复一次；未确认数字、跨企业引用、酒店仓库语义均拒绝保存。另设业务质量检查，区别可选数据缺口与已有供给缺口，检查行业单位和动作优先级。

大方案/决策使用与经营代次同样的 R2 完整文件、SHA256 和企业/资料性质校验，D1 留摘要。调拨执行凭据须明确来源仓和目标仓，费用须有明确凭据；选择记录不表示已执行。复盘只比较同一原始窗口和商品范围，实际出现新商品时显示范围变化，不把变化归因为方案效果。

完整默认检查已通过 Node 307 项、原 demo 渲染检查 20 项、类型检查、完整生产构建；之后身份修订失效回归单独通过。Python 最终 242 项通过。正式模型 deepseek-flash 的三行业 v1.7 全部完成，并通过针对事实数字、行业单位和已确认供给缺口优先级的独立检查。此前失败输出与调用账本保留，不抹除失败记录。该检查不证明全局最优或因果；外部检索本轮关闭，没有声称已核验当前政策。真实模型、离线和业务质量记录分别保存在 outputs/backend-closure/verification。

### 本地运行与边界

隔离运行目录：outputs/backend-closure/local-delivery。端口 3112 / 8148，自动巡检关闭，手动正式模型可用；外部市场检索此次关闭，因此不能声称已经核验当前政策。六家合成企业通过同一档案/导入/代次接口计算，原来的 3102 服务和原数据库未替换。

启动前执行 npm run build:local:stable，然后以 NEO_LOCAL_OUTPUT=outputs/backend-closure/local-delivery、NEO_WEB_PORT=3112、NEO_AGENT_PORT=8148、NEO_EXECUTION_MODE=live、NEO_MANUAL_CHAT=true、NEO_MARKET_RESEARCH=false 启动 npm run start:stable。构建指纹包含数据库结构与迁移；源码改变必须重新构建，不复用过期构建。

当前方案中的 cashBudgetCents 指追加动作投入上限，不代表完整企业现金流；价格/需求弹性没有实证资料时不推断。制造只支持单层 BOM 与单工序日产能；酒店逐日房型容量不跨日结转。业务字段与来源由接入方声明，未连接真实 PMS/ERP/MES，也不把合成方法验收当实际经营收益。


## 运行数据恢复与交付证据

新增运行备份：/Users/majun/Desktop/NEO/backups/neo-closure-runtime-20261007-062456。停止本次隔离写入后复制，35 个文件有 SHA256 清单，6 个 SQLite 完整性通过；复制到独立恢复目录后，六企业冻结预测总量与备份前完全一致。恢复时先停止 3112/8148 的当前隔离服务，把需要恢复的目录另存，再从备份复制 local-delivery 到新输出目录；不要覆盖原 .wrangler/state 或 agent-service/state。恢复副本可用 NEO_LOCAL_OUTPUT 指定，并先验证目录下 manifest 与 SQLite。代码恢复使用基线标签或阶段提交，在独立 checkout 中操作，详见基线备份 RESTORE.md。

证据目录：outputs/backend-closure/verification。large-http.json 是十万条真实接口验收；runtime-restore.json 是独立恢复；demo-protection.json 是保护文件校验；online-three-v1.7.json 和 online-business-quality.json 是在线与业务语义检查；browser-execution-proof.json、browser-outcome.json、browser-outcome.jpg 是合成执行与实际窗口复盘。所有演示企业和这些经营记录都是合成资料。

继续使用原工作台时保留原来的 URL；新隔离企业入口 http://127.0.0.1:3112/demo?businessId=neo-sim-ecommerce-delivery-1&dataNature=demo。酒店/制造把企业标识分别换为 neo-sim-hotel-delivery-1、neo-sim-manufacturing-delivery-1，第二家后缀为 -2。原 demo 入口 http://127.0.0.1:3112/demo?mode=example，布局、交互及受保护源码与基线一致。

## 现有工作台集成修正

新增行业数据进入默认既有组件：人/货/场摘要、4A旅程、库存或房晚、渠道对照、三域时间轴、预测曲线、条件编辑、决策保存和证据抽屉。行业条件在原预测编辑区核对，酒店增加逐日房晚，制造增加生产与物料产能约束；不建立第二套前端导航。既有行动草案和历史选择内提供执行凭据关联与实际窗口复盘。智能体追问沿用原对话面板，后端携带同代次问题上下文，并继续校验事实数字与引用。

本次验证：Node 全量 310 项、Python 242 项、原 demo HTML 20 项通过；后续 UI 状态修复完成受影响回归与类型/lint检查、稳定构建。六企业经既有接口回读同一指标与真实约束，页面 GET 不派发模型任务；跨企业资料拒绝读取。保护文件逐字节匹配基线。浏览器在原方案编辑区保存合成到货条件，履约从1件变3件、缺口从2件变0、方案贡献毛利23545分；选择理由保存并重启回读通过，未运行企业动作。

原 demo、原3102运行及数据库保留；更新的 /demo 仍在隔离本地3112运行。此端口隔离用于保护旧状态，并不是新建前端。当前验收企业的4A身份/历史覆盖及外部原文仍有缺口，未知指标不补零；外部检索关闭，AI判断按冻结版本手动更新。

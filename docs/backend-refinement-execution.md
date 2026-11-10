# NEO 后端精细调整执行记录

任务来源：`/Users/majun/Desktop/NEO/监督/backend-audit-2026-10-07/NEO后端审查与精细调整建议.md`。

本记录覆盖原文的 6 项缺陷、11 项业务契约及本地验收。生产部署、真实商家、模型质量及灾备属于原文另设验收，不以本轮本地结果代替。

## 第一批：正式事实、版本、库存与证据

| 项目 | 当前实现 | 验收证据 |
|---|---|---|
| F01 支付／退款账本 | 共享 `validateBusinessLedger`；按来源、订单及订单行验证有效支付、商品/渠道、日期、退款数量/金额/可确认成本。普通导入和分片封存均验证；已注册旧 CSV 入口也验证新旧合并账本 | `business-publication.test.mjs`、`business-legacy-adapter.test.mjs`、原审查反例回归 |
| F02 分片与正式去重 | 未封存同键记录返回 `409 IMPORT_PENDING`；不会发布完整覆盖的零收入。封存后相同正式请求可按已发布事实去重 | 原审查反例回归、跨分片退款与支付封存验收 |
| F03 默认经营代次 | 企业/资料性质 head 按事件截止和事件 ID 单调推进；历史补算保留但不回退 head。代次、head、自动审查事件与完成状态发布受有效租约保护 | 旧失败事件晚恢复、默认工作台与原快照接口、过期租约、内联/R2 存量迁移 |
| F04 调拨守恒 | 登记到货按是否有来源仓转换为外购或调拨动作，共用来源扣减、在途、交期与到货；登记计划费用计入预算，缺失费用保留未知 | 西仓 10 件调拨 6 件：履约 6、剩余 4；登记与手工动作同结果；来源不足、交期、取消与缺失费用 |
| F05 市场引用 | 持久化和回读共用引用转换，覆盖旧专业、新 `operatingReviews`、市场选中来源；部分结果按专业合并；重复转换不叠前缀 | 原审查市场样本、旧记录兼容、部分合并与幂等转换 |
| F06 执行凭据 | 只允许正式可见、当前有效修订；动作类型匹配；同一凭据及修订不得重复计入；原请求幂等回读。旧凭据被更正后，执行列表和复盘标记 `needs_revalidation`，不输出最终归因差值 | 未封存拒绝→封存后登记→修订后拒绝新登记→原请求回读→复盘待重验 |

发布事务以 `neo_business_publications.epoch` 做乐观并发保护。校验前读取 epoch，发布 batch 内只能递增同一 epoch；冲突导致整个 batch 回滚，不能让两个分别合法的退款共同超限。旧入口无新档案时保留其原有数据库约束和并发重复导入行为。

新增迁移：`drizzle/0016_light_mac_gargan.sql`。新增发布 epoch 和 head 表，不改写原业务事实。已有 head 的初始化按冻结 `knownAt` 选择，支持内联和 R2 summary，不按最近补算时间选择。

经营档案发布、资料暂存/发布、封存、当前代次推进、保存选择和执行登记均写入原 `audit_events`，与业务写入处于同一事务。失败发布不会留下成功审计；不另建日志平台。

Agent 请求采用 64KiB UTF-8 byte 上限；经营输入 1MiB、本地 HTTP 包装 2MiB 均提前限制，流超限时停止收集。大对象按声明大小／对象大小／实际流长度校验，最多 128MiB；这些预算不等于公网并发或网络安全验收。

## 全文任务对照

| 原文条目 | 已落实的本地契约与证据 |
|---|---|
| 支付量与实际履约量 | 冻结 measurement：普通订单为净支付数量，酒店为已入住房晚；不证明实际发货或退款返库。接口、训练及新页面单位一致；退款净量/金额/成本冲回纳入训练，负净值窗口保持不足。指标 `business-metrics-v1.2`、推演 `constrained-operating-v1.4` |
| 客户身份与 cohort | 默认来源内识别；有效主数据或已发布 enterprise 身份规则才能跨来源合并。来源规则与 profileVersion 冻结；未统一身份时企业人数/转化率未知。cohortStage 控制选定阶段到购买，三段旅程保留独立锚点。`business-journey` 回归验证 |
| 新事实与 Ontology | `neo-operating-v1` 新增 13 种只读对象类型，直接从冻结 generation 形成 ObjectSet；支付、房晚、物料单位分开。保留旧 snapshot/custom 定义；缺少映射会报告 partial，不能静默丢失。新迁移 `0017_pretty_revanche.sql` 为 build 独立绑定 generation，保留旧 snapshot 外键；不复制第三套业务事实。旧 Python 模型／ObjectSet Agent 拒绝新代次，使用既有新工作台的计算与审查入口。`business-ontology-generation` 验证修订/知识截止/隔离/数量单位 |
| 预测解释与评估 | operatingModel 保存真实日均模型、训练窗口、净支付／入住目标、预测天数和 not_evaluated；没有借用旧模型成绩。新页面按保存 horizonDays 与 unit 渲染，旧电商路径保持原文案；房晚 3 天渲染验收 |
| 库存与未估计实体 | coverage 返回 forecasted/unestimated 实体、未扣减未知需求的库存及总额范围；覆盖不全禁止全企业最优推荐，不能把未知需求当零，库存资金未知保持 null。专业审查 basis 同步冻结覆盖与计量解释 |
| 多轮追问 | 同企业/资料性质/代次复用逻辑 session；最多 4 轮、8 条有界问答历史，Python 实际接收 user/assistant 历史。跨代次复用拒绝；后续对话不改变旧 requestId 重放。Node 会话与 Python history 回归通过 |
| 审查状态回写 | 后台更新消费者统一同步新审查，工作台/direct/compat GET 只读同一已保存状态，GET 不访问模型。消费者包含活动经营审查，不依赖用户打开页面。回写与对应证据以 CAS 同事务接受 |
| 本地与部署调度 | stable 与开发 launcher 挂同一 update pump；Worker 提供单次 scheduled 消费适配，默认不开启。无 cursor 的周期优先最久未处理项，本地按企业+资料性质轮转。消费者独立测试及 stable 隔离运行验证；开发 launcher 未用现有凭证启动，云端 cron/服务/部署未启用 |
| 大规模读取 | 收入/费用/事件/入住按所需业务窗口读取当前可见修订；库存/约束历史保留。新旧适配共用窗口边界，账本校验保留全历史。推演最多 100,000 个实体渠道日组合，超过返回资料不足；Ontology 单 build 10,000 事实。十万订单的真实临时 D1/R2 计算和工作台完整回读通过。高渠道/商品基数、并发及生产容量未验收 |
| 请求与资源边界 | UTF-8 byte/流预算前置；本地真实 Content-Length 与 chunked HTTP 超限 413 后可继续正常请求；R2 超声明大小在分配前拒绝，流超限取消。`business-resource-boundaries` 验证。不将本地 HTTP 缓冲实现表述为公网容量证明 |
| 可追溯审计 | 发布、资料修订、分片封存、head 推进、选择、执行与 Agent 结果状态/内容变化写原 audit_events。成功记录与业务写入同事务或相同结果 CAS revision；失败/过期发布不留成功审计。保留不可变旧结果及待重验标识 |

## 本地运行验收

独立企业 `test-a`，隔离 `outputs/backend-refinement-local/runtime`，localhost 3192/8152，offline 且自动巡检关闭；不读取生产 seed、不调用真实模型或检索。原 `/demo` 首页、人、货、场、方案与证据 API 同一代次回读；浏览器可见净成交 700 元、贡献毛利 560 元、库存 10 件，未来 3 天可承接 3 件。原文冻结 Demo 的 8 个基准文件保持字节一致。

十万条订单单进程、临时 D1/R2：代次计算约 4.864 秒；工作台回读约 0.544 秒、26,451 bytes。测得该 Node 进程 RSS 从约 390MB 至 850MB；不是稳定峰值或整个 Miniflare/Worker 总内存。数据为直接写入规模 fixture，不包含 HTTP 上传吞吐、并发用户、真实模型或公网容量。输出完整代次到 R2，compact readback 保留 inputCount 并验证精确金额。

## 验证与运行边界

第一批 Node 319 通过；后续全套与修复回归见下列最终日志。Python 当前工作区全套 247 passed；最终 TypeScript 通过。新增测试直接调用真实 API 与临时 Miniflare D1/R2，市场使用本机 mock，不调用真实模型或检索，不写原商家数据。修改的后端及其他受影响文件 ESLint 通过。live-agents.tsx 原有 15 项错误/相关 warnings 未扩展修复，与 HEAD 基线一致；live-overview.tsx 的基线检查另见日志。最终 Node 327 passed / 0 failed；Python 247 passed；rendered-html 20 passed。TypeScript、生产构建、本地稳定构建、其余修改文件 ESLint 与 git diff --check 通过。live-overview.tsx 0 errors，与 HEAD 相同。完整后端源码指纹与实际隔离运行均为 `52358dd90e2cf5c5c9069f9eedb8ba2143fe4232b8fa17076ee92d002a69d9a5`，见 final-source.json / http-readback.json。

验证产物目录：`/Users/majun/Desktop/NEO/监督/backend-refinement-2026-10-07/`。原审查目录保留原始反例，本轮将正确行为的回归用例放入主仓 `tests/`。

本轮开始时主仓 HEAD 为 `f2ad300`。执行中另有 Python 智能体运行时工作出现并随后撤回/调整；本轮不接管该工作，最终校验以当前源码为准。既有未跟踪日志、原始业务库、seed、模型凭证与对外部署均不作为本轮修改对象。

本轮未替换先前 `3112/8148` 服务；隔离 stable 验收已实际运行、读回并在完成后关闭。新代码尚未部署到真实商家或生产服务。

回退按本轮受影响文件的原 HEAD 内容及补丁进行；未迁移真实业务库。后续迁移执行后，代码回退应保留新增表与不可变事实，不自动删除用户后续输入。

## 回退与后续验收

完整本轮文件清单、当前 SHA-256、补丁与 HEAD 原件保存在验证目录。补丁包括新增文件，排除现有无关日志和 agent-runtime-optimization 文档。未迁移原业务数据库；0016/0017 只在隔离库验收。后续迁移生产前应备份实际 D1/R2/队列，再单独验收恢复；代码回退不得删除用户后来输入的事实。

真实数据接入、人工统一身份规则、履约/返库独立事实、真实模型与检索质量、云调度部署、生产并发容量及灾备属于另行验收条件。本轮不会把模拟数据或 mock 服务视为这些结果。

最终证据：`final-node.log`、`current-python.log`、`final-typecheck.log`、`final-eslint.log`、两个前端 lint-baseline.json、`final-build.log`、`final-isolated-build.log`、`final-rendered-html.log`、`capacity-readback.log`、`http-readback.json`、`http-scope-check.json` 与 `browser-check.md`。浏览器截图：`forecast-browser.png`。未创建 Git 提交或远端推送。

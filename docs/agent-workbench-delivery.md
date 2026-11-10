# 现有工作台、对话与评估交付

所有界面改动位于 operating 组件和 `/data/ontology` 现有经营规则/智能体设置。保护的八个 example 文件保持字节不变。没有新增 dashboard、路由模型或数据库副本账本。LangGraph、FastAPI、TS 计算、持久队列继续使用。

## 本轮使用状态

主体能力已接入现有组件，最新主体检查点为 `db9dd95`。当前新增付费验收暂停：有两笔调用完成/计费未知，保留原任务与账本，不重发或换批次绕过；读取已保存结果无需模型调用。后台自动监控保持关闭。运行和恢复时沿用原资料 `outputs/backend-closure/prior-data`，不重新seed。完整60模型质量和业务人员评分仍待完成。

需要只读查看本地版本时使用已有稳定构建并关闭模型与后台任务：

```sh
NEO_LOCAL_OUTPUT=outputs/backend-closure/prior-data NEO_WEB_PORT=3112 NEO_AGENT_PORT=8148 NEO_EXECUTION_MODE=offline NEO_MANUAL_CHAT=false NEO_MARKET_RESEARCH=false NEO_KNOWLEDGE_MONITOR=false NEO_MONITOR_ACCEPTANCE=false npm run start:stable
```

下面保留接口及评测入口说明；带 `--execute` 的provider例子当前不执行。

## 启动原验收资料

```sh
npm run build:local:stable
npm run start:acceptance
```

`start:acceptance` 固定 `NEO_LOCAL_OUTPUT=outputs/backend-closure/prior-data`、web 3112、agent 8148。端口占用或构建摘要不一致会停止。不会运行 setup 或生成替代经营数据。`/__neo_version` 回读 branch/sourceDigest、执行模式及原验收 seed。其原有监控默认只包含验收企业；六个评估企业不自动启用后台观察。实际收费模型、最终浏览器和原页面 DOM 比较由 root 控制。

## 界面与冻结对话

首页简报及市场界面显示同一已完成、语义校验通过、企业/性质/版本一致的完整 assessment。失效知识依赖不作为当前判断。对话详情、经营证据抽屉展示确切 supportingReferences.exact、指标单位、支持状态、反证核查意见、待确认条件与保存时间。checker 的自由文字缺口/反证意见单独标注未作为独立事实核验。

普通问候/帮助在现有 chat 本地回答，无模型、检索、预测或完整复核调用。事实问题从当前冻结目录精确匹配商品/SKU、渠道、最近四周/明确日期与保存方案。未登记规格、多个对象或越界日期先澄清。下一轮“那库存呢”由已授权 session 延续范围，专业切换沿用 session；每轮重新读取冻结事实。SKU 分组不把商品级费用猜分摊到规格，不把商品级 evidenceId 伪装成 SKU 计算引用。

`DialogueScope` 增量支持 skuId；历史范围仍可读取。快照路径验证商品、SKU、渠道归属。canonical 输入按实体建模，规格需使用已登记实体。没有新增 Drizzle migration，本阶段复用 Task1–3 的增量迁移。

设置中的来源管理显示版本、启停、明确读取/继续按钮、调度与最后成功时间、失败/partial、pending review、stale dependencies。只承诺登记页面的 current observation。对话/证据可以保存企业知识候选；有写权限用户填写核验依据并点击人工确认后才激活，模型意见不自动成为企业规则。

## 默认验证与冻评估

`npm test` 先运行全部 Python，再运行自动发现的 Node/API/UI tests，保留原 build + rendered HTML 检查。`tests/fixtures/frozen-cases.json` 是 root 冻结的 60 标签原文件精确复制；SHA256 `832f078da40fff0751e9f1bc18d69f56e0d2960e4b7e6555fe148ade31c611f7`。评估前核对 receipt，不按模型输出修改标签。六个独立企业配置在 `tests/fixtures/frozen-businesses.json`，可编辑配置而不改实现；其资料全部 synthetic。

```sh
npm run evaluate:frozen
```

每次新建独立输出目录，保留 inputs、每例 request/result/model-call journal、calculator anchors、API 对话范围/权限与归属断言、queue restart receipt。诊断 30 例执行真实 Runtime graph/queue 和 TS structured records/constraints 计算；政策 14 例执行真实 KnowledgeRuntime extract/verify，另 1 例 HTTP200 登录页由 production reader 阻断、不抽取。15 个 native 合成原文读取夹具保留正文版本、current-only coverage 和转载 original document/job 归一证据。明确 scripted extraction/checker 仅检验协议、引用、效期/适用隔离；对话 15 例经现有 API POST、正常目录匹配与 freezeConversation。mounted chat 测试直接输入自然问题、问候、追问及专业切换。不会把传入完成 assessment 数组或 label inventory 算作 Runtime 运行。

数值 anchor 来自独立结构化事实/计算；未核业务语义、因果、动作可行性及上下文质量仍 pending。特别是缺货同症不同因、未执行、条件变化、窗口未成熟、未归因结果的**模型回答质量**没有因离线传输通过而通过。全部五维评分保持 null（问题识别、证据相关、限制、行动可行、会话连续性），预声明 NA 保留。60 例机制执行不等于 60 例模型或企业质量验收。

## 有界线上调用

可直接读取同一冻结夹具，无需手工建立 60 个 API snapshot：

```sh
npm run evaluate:frozen:prepare -- --out outputs/agent-optimization/provider-inputs
npm run evaluate:frozen:provider -- outputs/agent-optimization/provider-inputs/inputs.json outputs/agent-optimization/provider-run-001 --execute --cases ecommerce-refund_margin,knowledge-wrong_region,dialogue-sku_hold --limit 3 --max-total-calls 12 --max-total-tokens 120000
```

在调用者环境明确配置 `LLM_MODEL`、`LLM_BASE_URL`、`LLM_API_KEY`。prepare 不进行模型调用，生成六个企业的 distinct structured inputs、计算后的范围及自然提问；provider 默认没有 `--execute` 就只回读输入。每次输出须新目录，保留失败及原队列，不自动重试。诊断走明确 DIAGNOSE、政策走 KnowledgeRuntime 原段落抽取/支持校验，对话走实际多轮 NeoRuntime 并携带真实上一轮结果为历史上下文。SKU/channel/period 范围由同一匹配器与 `scopedOperatingReviewBasis` 重新计算。API 权限、候选确认和正常 UI 操作由独立默认门禁验证，直接 Runtime 调用不冒充 API 鉴权证据。不可读原文保持阻断、零抽取调用。

每次 HTTP 前按完整 UTF8 输入上界 + completion 预留核对聚合 token cap；总调用 cap 跨六个企业共享，已知拒绝、实际 usage、unknown 及其预留分开保留。使用量缺失或完成不确定即停止后续收费请求。所有状态均未自动评分，输出 `unsupportedExpectations` 列出无法靠当前 structured fixture 证明的具体业务期望；尤其租户/权限拒绝和人工确认是 API 行为，不能由 provider 回答替代。全60运行可将 `--limit` 明确改为60，仍受 aggregate caps、失败阻断和未覆盖期望约束。


既有真实验收资料的 API/monitor 入口继续使用 `npm run evaluate:frozen:live -- --execute --manifest <file> --cases <ids> --limit 3 --max-model-calls 3 --max-tokens 12000` 明确 opt-in，默认无调用。manifest 必须提供原 hash、actual inputPath、每例实际授权 businessId/dataNature/snapshotId、精确 natural turns 与 fixtureReference。没有缺失输入时的 generic QUERY 替代，也不自动生成业务/改原 seed。每轮 task cap 仍由服务端进一步收紧。

```json
{"frozenHash":"832f078da40fff0751e9f1bc18d69f56e0d2960e4b7e6555fe148ade31c611f7","inputPath":"实际隔离资料目录","cases":[{"id":"dialogue-sku_hold","fixtureReference":"实际输入证明","scope":{"businessId":"已配置企业","dataNature":"demo","snapshotId":"已冻结版本"},"mode":"joint","turns":[{"question":"SKU-R1最近四周成交多少"},{"question":"那库存呢"}]}]}
```

知识例的 manifest 使用现有 monitorTaskId、action=resume/recheck 及 documentId，而不是数值 chat；重新读取原文与原段落支持继续走 KnowledgeRuntime。保存 admission/result、observability/usage 与所有失败。知识 gateway 只公开 document/run references 时，receipt 明确标注需要 root 附上私有服务 per-call journal，不虚构 tokens。全量线上 60 与代表线上检查分别记录，未执行例保持 not_executed；脚本不自动评分或冒充人工复核。root 的 `business-review-worksheet.md` 全部仍待实际业务人审阅。

## 恢复与已知限制

每例队列 SQLite 与 LangGraph checkpoint 位于评估目录；重新初始化/recover 检查已完成任务不再派发。lease/restart/uncertain/backup 检查沿用已有默认测试和 root 独立恢复工具。本阶段不删除原失败 receipt、原资料或用户改动。

线上的自然实体匹配只在可读冻结目录里精确匹配；别名、模糊描述、任意新企业词汇须澄清。条件性推演与保存选择不代表行动发生，也不证明实际利润或因果。模型 5 维均分 ≥4、关键例 ≥3 且零关键错误的门槛尚待线上/业务审阅；离线 scripted checker 不提供这些质量证据。

结构化夹具已补齐保洁/接待能力、制造材料晚到与周五截止、多仓物料调拨、原生价格与现金条件，以及 A/B 稳定情景和真实新增记录 V2。原生输入与机制 oracle 已验证；价格弹性、上海/杭州真实政策资格和竞品同规格促销仍缺独立真实来源，不能因合成元数据或 provider 完成通过相关业务期望。对话完整语义、实际执行归属和全部五维评分仍待真实模型及业务人员复核。

监控校验的8条抽取主张展开为32个待核陈述时，现在按12/12/8小批次核验。每批保留全部精确原文及反证范围，doc/version/scope只发送一次；显式索引与数量、严格覆盖校验、一次有限格式修复仍受原8调用/60000tokens限制。旧已完成抽取在显式恢复时由原checkpoint回读。

provider入口在入队和请求hash之前将actual LLM_MODEL冻结到请求的modelIdentity；prepared输入不变。receipt同时保存fixture原lineage与实际执行HEAD/sourceDigest，各轮admission-lineage保存前后模型/请求hash。未执行或失败的原receipt保留，不能改其版本后冒充成功。

35e87e3 已实现 I1–I3 的主判断统一选择、来源追溯/列表审计及 typed 复杂情景输入。独立复审与线上门禁仍未通过：设置读取错误路由、候选周证据范围、服务能力来源覆盖和现场提示预算/记录域混淆在本次后续修复闭环；Task4 未关闭验收。


## 评审修复后的输入与来源边界

主判断均由当前完整 assessment 选择；巡检/简报失败或过期时，原结果只在原保存时间与状态的历史视图回读。模型候选保留 run/input/evidence/模型来源与 SKU、渠道、期间；后端验证后登记精确输入和继承知识依赖。人工确认保存操作者及依据，不扩大原范围。已有候选在设置列表可确认或拒绝；无引用的人工陈述独立审计，不能冒充模型来源。来源换代使确认知识失效，跨商品/渠道/期间不能沿用局部规则。

冻结自然追问共用 `scripts/frozen-dialogue-turns.mjs`，A/B 使用原计算基线和稳定保存 ID；V2 由新增记录重新计算形成不同代次，不用布尔标记代替变更。酒店保洁/接待能力与材料晚到/跨仓调拨有真实 typed inputs 与原生计算检查。价格参数只作条件推演，现金需求另于费用记录，未确认弹性/预算不宣称最优。合成外部政策/竞品元数据只用于结构与边界测试，不是已核实真实来源。

普通客户页订单/退款查询只向生成模型投递所问指标、单位、期间和证据；完整周/身份/明细仍可按需分页读取。全部输出数量绑定已有 metricKey/value，不在假设、确认问题和行动正文重复中文数量或带数字的 SKU ID。原格式修复最多一次、QUERY 原3次/12000token上限保留。


## 现场失败后的定点修复

设置实际读取 knowledge-sources、monitor、agent-memory、knowledge-items 四个已实现路由；真实 handleApi 同时回读与 mounted 严格路由检查通过。weekly 证据候选从完整 week:start:metric:product:channel ID 提取产品/渠道，未限定 ID 继承不可变快照的 productId/channel；不能把局部知识保存为其他商品规则。已登记酒店服务能力要求预测完整窗口 coverage，保留行而删除/缩短覆盖时返回 insufficient 和 null，不把局部排班当完整约束。

35e87e3 现场客户 QUERY 0 调用 TOKEN_BUDGET、refund_margin 累积三次后 joint 预算拒绝、sku_hold CLAIM_NOT_SUPPORTED 的原 receipt 均保留。离线回放直接使用原打包输入/历史与保存的 provider 响应，不替换成小 mock；跟踪 fixture 的原 run、原 HEAD 与输入 SHA。当前输入重复对象用 JSON Pointer 无损引用，所有值、null、status、反证和范围 roundtrip 不变；完整版本 hash 留在原请求，模型只读版本名称、digest 和显式新旧输入/变更状态。订单数量投递为原 JSON，无须重复表格协议。普通页原 QUERY 初始预留从 12627 降到 11557，原上限 12000 不变；两轮离线运行验证生成与 checker 实际预算路径，计费 usage 为测试 adapter，不能当 provider 实耗。refund 原已耗 29291，joint 新保守预留 29965 合计 59256，低于原 60000；此回放只捕获下一轮 admission，不伪造未保存的 joint 回答或业务通过。

费用/成本本身不自动召集市场专业；返库涉及供给，渠道投放、竞品与政策仍走相关市场路径。read_saved_records 仅属选择与情景计算，不能用其 missing 断言退款明细未冻结；支付/退款原记录由 read_frozen_records 加 entryType 查询。指标 complete 的冻结范围不得被正文描述为退款来源缺失，该错误进入既有一次有限格式修复；程序继续严格校验。support 目录同时提供精确已读约束记录和当前 forecast，不能凭空将已提供仓库规则说成缺失。最新真实模型重验、完整60线上门禁和业务评分仍 pending；未冒充通过，也未提高 cap。

当前判断还须匹配当前发布配置：同一 legacy 快照从默认或 V1 发布到 V2 后，旧判断及晚完成任务只保留原时间、原配置下的历史回读，不能成为首页、专业或统一判断正文；读取不触发替代任务。反证中的精确整段/字符片段与嵌套 claim、document、source 版本同支持依据一起登记依赖；相关依据变更或禁用会使结果 stale/conflict，自由校验评论不成为依赖或事实。实际 API、mounted 与依赖失效定点回归通过；独立复审、完整线上/业务质量门禁仍待验收。

真实客户页“笔数→商品件数”追问的 DIAGNOSE 误分类已做定点修复：指标名式问句进入原 QUERY3次/12000token，继承原期间，明确件数只投递 unit metrics；共享来源 ID 保留，240/21件仍需精确 metric 支持。原失败输入和历史保持不变，离线回放通过，真实模型复验待 root 执行。知识评测 offline/provider 共享准备企业/SKU/渠道与原生文档 UTC 时间及完整 provenance；缺身份/范围拒绝入队。空claims仍 NOT_COVERED，不冒充质量通过或改变冻结预标注。

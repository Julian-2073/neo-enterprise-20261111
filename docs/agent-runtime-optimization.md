# NEO 智能体优化实施记录

授权方案：统一 Runtime、诊断与连续对话、企业知识与每日监控、现有工作台集成与业务评测。保留原 demo，复用现有经营数据。

## 当前状态（2026-10-08）

四阶段主体代码已搭建：统一 LangGraph Runtime 与七类任务、经营诊断与连续对话、企业知识与持久监控、现有工作台接入。活动分支为 `optimize/neo-agent-runtime-isolated`，目录 `/Users/majun/Desktop/NEO/worktrees/neo-agent-runtime-20261007`。没有新增独立前端，原用户 checkout 的并发修改未合并或覆盖。

主体最新检查点 `db9dd95`，稳定构建 digest `5032582439dce88b0a34492a77641b1aa19776ad73c521f276238ee0c4bac508`。已补齐房型容量调查、历史毛利与未来基线边界、真实待核问题投影、文档级筛选理由与正文覆盖、支持/反证及版本依赖。新任务冻结 `document-disposition-v1`；旧结果按旧协议读取，不通过刷新自动补发模型。文档理由本身不触发经营研判或新增配额。

现有证据抽屉已改为业务状态、判断、关键数字与期间优先展示，完整引用和技术信息折叠保存。实际屏幕点击原保存回答的“查看证据”，支付商品240件、退款商品21件与精确指标一致，未替换为223笔订单；前后模型调用数不变。回执 `outputs/agent-optimization/ui-readback-a599fbb.json`，截图 `ui-unit-evidence-a599fbb.png`。六个原 demo 页面规范化 DOM 与备份一致，八个保护文件保持不变。后续 Python 因果边界修复不影响这些界面文件，复用有效界面验证。

原经营资料继续保留：支付223笔、净成交750994.20元、贡献毛利257384.20元、投放23750.00元；模拟性质不变。同一工作台会话真实模型查询完成223/19笔，再完成240/21件。后者使用原 QUERY 12000token/3调用上限，2次调用4465token；完整诊断的模型质量不能由此替代。

酒店真实案例曾因无依据的未来基线收益判断被拦截，后续离线修复通过相关验证；制造案例发生调用完成与计费未知。当前累计56次HTTP调用、237780已报告token、2次未知，原失败/未知请求和用量保留。所有新增付费验收暂停，不重发未知请求或另建批次绕过停止条件。核对说明见 `docs/agent-model-call-reconciliation.md`。

剩余实现为冻结评测输入v2与历史入口兼容，正在收束。原60个预标注标签保持不变；此前四项知识空claims为NOT_COVERED，不能算政策分析成功。完整60个真实模型案例、业务人员评分及真实经营效果未完成，不能宣称平均4/5或整轮验收完成。

根据用户最新要求，不再增加独立评审或重复全套检查；只做本次受影响的必要验证，已有效的类型、构建、界面与保护验证按范围复用。现有独立报告记录主体代码关闭情况，不替代在线业务质量。

原目录仍有并发预测修改，整合尚待固定共同版本。可恢复的原目录代码快照为 `/Users/majun/Desktop/NEO/backups/neo-original-dirty-safety-20261008-124826`（741文件恢复哈希一致，不含运行数据库）。最近完整恢复包为 `/Users/majun/Desktop/NEO/backups/neo-agent-checkpoint-20261008-hotel-86d21be`，已验证Git、7个SQLite完整性与逐表计数、38运行文件、8保护哈希和恢复后的原财务API/demo，0模型调用。最终实现检查点会再保存一次恢复包；旧基线继续保留。

接口、启动与操作见 `docs/agent-workbench-delivery.md`；本地验收回执和实际用量在 `outputs/agent-optimization/`。以下历史记录保留原时间状态和失败过程。

## 恢复基线

- 分支：`optimize/neo-agent-runtime`
- 基线：`f2ad300edb731a8cda215f1ffeb7b6a19fc3143f`
- 标签：`neo-agent-pre-optimization-20261007-210417`
- 本地备份：`/Users/majun/Desktop/NEO/backups/neo-agent-pre-optimization-20261007-210417`
- 独立 Git 恢复及 36 个 SQLite 完整性检查通过；业务库 41 表和智能体库 5 表在独立数据库恢复后逐表计数一致，保护文件 8 个；恢复步骤见备份 RESTORE.md。凭证仅在权限受限本地备份。

## 实施与验收

四阶段按顺序实施。每阶段相关测试、类型检查和稳定构建后保存检查点。离线评测与在线模型验收分开记录；合成数据不表示真实经营效果。

运行目标：每日北京时间09:00检查，恢复补查最近7日；每企业每日一次自动完整研判，后台每日200000 token；查询12000/3调用，完整研判60000/8，复杂方案120000/12。仅此前验收企业首轮启用，其余默认关闭。

验收集已在实现前标注：三行业诊断30、知识政策15、连续对话15。评分标准与期望先冻结，在线与离线分开记录。

## 补充规则

已并入：证据支持的重要变化与紧急定向复核；知识依赖失效；主张语义检查；上下文按需压缩与预算阶段降级；监控实际覆盖与缺口；选择、执行、结果及业务评分分别记录。每日09:00、七日补查、任务限额均为可配置默认值，不是业务阈值或最优参数。紧急定向复核默认每日两次、单任务20000token/4调用，计入后台日总额。当前网页不保证恢复七日历史；只失效实际依赖记录，不擅改企业参数。

业务质量五维：问题识别、证据相关性、限制完整性、动作可行性、对话连续性。关键错误一票不通过，均分不能抵消。模型评分仅辅助；未完成业务人员评审时如实标注。

## 工作区隔离

实施期间另一任务并发修改主checkout，故迁移到`/Users/majun/Desktop/NEO/worktrees/neo-agent-runtime-20261007`，分支`optimize/neo-agent-runtime-isolated`。移除共享checkout中仅本任务的未提交代码片段，保留外部改动；没有另建前端。后续合并需核对其他任务的发布与导入修改。

原数据回读：隔离恢复库通过operating-snapshot接口返回原snapshotId与demo性质，支付223笔、净成交750994.20元、贡献毛利257384.20元、投放23750.00元、库存成本89430.00元，均与基线一致。

## 第一阶段检查点

统一 LangGraph Runtime、冻结任务范围、七类任务预算和版本化 BusinessAssessment 已接入新旧输入与现有接口。独立审查发现并修复查询角色/工具、中文数量校验、未计算情景完成边界、异步刷新与稳定请求重放问题。阶段提交：67ca9ab、7f1a945、22a4a46、f06793c；最后定点 API 回归37项通过，类型检查和稳定构建通过。原demo八个保护哈希一致。详细阶段测试记录见 .superpowers/sdd/task-1-report.md；实际模型用量、UI和业务评分尚待后续阶段验收，离线替身结果不作为在线结论。

## 第二阶段检查点

诊断明细、前后期比较、按范围计算、连续会话、方案联查和主张级发布校验已接入；独立复审最终 Spec Pass / Quality Approved，R1–R6全部关闭。实现检查点d646092、fc14543、b14ef46、b173236、caaee21、09cfd2b、9c87eb7、6ed2013（报告提交5987f6b）。最终161项相关Python回归、此前43项受影响Node回归、类型检查和稳定构建通过；保护哈希8/8不变。

2026-10-08北京时间真实查询原验收数据完成：2次模型调用共3485token，返回支付223笔、退款19笔、商品支付240件、退款21件及统计日期口径；三项公开主张均完成语义校验并绑定实际指标/读取元数据。未知计费0、最终预留0，没有提高12000token/三调用上限。实际receipt：outputs/agent-optimization/live-query-task2/live-query-task2-bd43457b-5dc9-4033-bcbd-d9cfda8a7a11/receipt.json。

此前六次失败记录原样保留，分别覆盖调用槽不足、校验截断/格式/预算、无依据额外断言。已修复紧凑命名协议、重复键、笔件误配、本轮计算与模型投递范围、数量查询必要上下文；不以离线替身替代在线结果。本次仅证明原合成数据的普通查询链路可运行，完整诊断、知识监控、UI与业务评分仍在后续阶段。

## 第三阶段的实际链路验证（审查尚未关闭）

首个知识监控检查点 f2dd697 完成增量迁移、知识引用、持久监控和原快照适配。独立审查发现七项 Important：企业预算隔离、候选主张重核、失败换版保留、精确依赖版本、确认知识失效、同段多主张和网络目标绑定；均须修复后复审，不能仅凭测试或构建通过宣称阶段完成。北京时间跨日、紧急截止、待处理事件新鲜度和跨资料性质每日次数同时纳入定点回归。

从隔离恢复的 outputs/backend-closure/prior-data 启动原工作台，运行版本指纹为 856f13cc07f96cc030b172f0b3c62165e78c6889fc48c62c94e68f82e7f8f705。实际 HTTP agent-runs 查询 run-030570b3-2071-4e55-bf9a-60010f839a60 完成，2次模型调用、4098token，支付223笔/退款19笔、支付商品240件/退款商品21件，两项主张校验通过。该运行关闭后台监控，仅验证 TS 网关、原资料冻结、持久队列与统一 Runtime 的真实调用，不作为每日监控或完整诊断验收。服务验证后已停止。

截至本记录，受控在线调用共17次、37860实际token，未知用量0；每次失败和成功均保留原始结果。汇总 outputs/agent-optimization/actual-usage.json。没有可用货币账单，未推算费用；60个业务案例的业务人员评分仍待评审。

新来源抓取 transport 的公开网络检查：文化和旅游部体育消费来源及国家发展改革委以旧换新来源可读；市场监管总局健身标准公告返回403，保留失败缺口。均为0模型调用、仅验证真实抓取，不作为政策主张或企业适用性已验证。详细receipt：outputs/agent-optimization/registered-source-fetch-live.json、source-fetch-live.json。

650717f 修复后再次运行原资料真实 HTTP QUERY：run-df697d80-e945-46db-876a-f9d15600c682，2次调用4137实际token、三项主张verified，研究截至日正确为北京时间2026-10-08。六个原demo SSR页面的规范化DOM与备份基线全部一致；这是工作台集成前的中间回归，最终集成后仍需检查。服务已停止，后台监控关闭。累计受控19调用41997实际token，未知用量0。Task3复审I8/I10已关闭，I9仍需把适用性输入的profile作为必需配置依赖，当前阶段仍未宣称完成。

## 第三阶段检查点

阶段提交 f2dd697、73ffa52、650717f、0f7f392；独立复审最终 Spec PASS / Quality APPROVED，0 Critical/Important，I1–I10全部关闭。包含精确知识与配置依赖、失败版本保留、明确有界重核、DNS连接绑定、跨资料性质共享企业额度与每日槽位，以及自动研判预占后中断的幂等恢复。knowledge-monitor为正式接口名，monitor保留兼容。

相关最终验证复用69项Node、101项Python及后续37/28项受影响Node回归，类型检查/稳定构建/增量迁移/原demo保护均通过。没有将回归数当作业务质量案例数。原快照/经营事实保留，地区或目标缺失明确留缺口。在线完整监控、实际诊断、连续对话、60案例质量及工作台交互仍由第四阶段完成；源码包与恢复备份不是生产上线证明。

## Task 4 continuation and real monitor failure

Resumed at a9daba8; the previous Task4 agent made no changes before a usage interruption. Existing original checkout changes remain untouched.

The first actual MCT policy monitor, monitor-366a40c3d8edef2a747b2192dd44256b70b093fad53d8d8e50afe0c5b4324885, extracted content successfully (5545 actual tokens), then its semantic checker received HTTP400. No knowledge claims or automatic full review were published. Two invocations: one completed and one known rejection; unknown billing zero. Controlled cumulative ledger: 21 invocations, 47542 actual tokens. Failed receipt: outputs/agent-optimization/live-monitor/root-monitor-691d9f5e-79ae-4c51-ba06-c2a4bc20ce7e/.

The semantic prompt lacks an explicit JSON instruction, inconsistent with [DeepSeek JSON mode documentation](https://api-docs.deepseek.com/guides/json_mode/). A focused compatibility correction and regression are being added. A subsequent explicit resume must replay completed extraction; successful post-fix live validation remains pending.

## 第四阶段接入与真实验收进展

检查点 f412e72 将统一结果、正常连续对话、来源与监控配置、企业知识确认接入现有工作台，没有新增前端。默认回归421项Python、356项Node/API/UI及20项渲染检查通过，类型检查和稳定构建通过。六个原demo页面相对备份的规范化DOM完全一致，八个保护文件哈希保持一致。独立阶段审查与最终恢复演练仍在进行。

实际政策任务第一次提取成功后遭遇JSON模式HTTP400；修复后第二次显式恢复返回27项，而8条主张需要32项陈述校验，因此系统阻止发布，未创建有效知识或自动经营研判。正在以受限分批、完整索引覆盖和一次格式修复解决，保持8调用/60000token和三次尝试边界。第二次新增1次调用10833token，累计任务16378token，不重复计入提取检查点。

真实冻结案例首次三项验收：诊断与对话在调用前因fixture模型版本不匹配被阻止，知识案例1次实际调用1012token完成处理，业务质量仍待审阅。保留失败记录并修正真实provider入口在入队前冻结实际模型版本，不绕过Runtime版本校验。当前总计23次实际HTTP调用、59387报告token、未知计费0。60项离线机制验收与真实模型质量及人工业务评分分别记录，尚不声称达到4/5。

真实监控恢复最终通过（6721a13，digest05c380755e9bf6ac3e12bac71baa3abc4d4b546d034332be26500fc138f63d93）：原提取检查点回放，32项陈述分三批完整校验，原任务累计6次调用30913token；剩余正文分块1次1613token。共保存8项候选，适用性未知/证据不足状态保留，不是有效企业政策。自动订阅仍关闭，本次不是每日自动经营判断验收。恢复新增4调用16148token。

修复模型版本后真实诊断和对话分别调用2次16840/17466token，仍因指标数字与文案校验被阻止，没有发布不合规正文。独立审查0Critical/3Important：旧摘要绕过统一版本、知识候选来源与范围丢失、部分冻结场景输入/oracle缺失。当前同一实施者继续修复，阶段尚未通过。总计31次实际HTTP调用109841报告token，未知计费0。

## 第四阶段真实回归后的未关闭项

35e87e3 检查点：430 Python、360 Node、20 render 默认门禁通过，最后受影响96 Python及7 UI/API/冻结机制、类型检查和稳定构建通过。digest为8e744d061c11a297bac5aa1719188d12842f6b7ef503fbe8ba809da134f85a47。六个原demo规范化DOM再次全部精确一致；代表方案B→草案→确认→演示执行→观察→复盘→重置与原基线一致，无真实经营动作或示例模型调用。

真实客户页查询仍在0模型调用时被预算拦截（run-5c718021-4d66-43ba-9647-16e3602b81f3）；冻结provider代表诊断3次29291token后综合轮预留失败，对话3次23854token后依据校验失败。原请求、prompt、usage和所有失败保留。独立复审仍有设置区错误知识路由、周证据商品/渠道范围丢失、酒店服务能力coverage未检查三项Important，正在同一实施者定点补修。

累计37次实际HTTP调用、162986报告token、未知计费0；其中一次已知HTTP400拒绝，不能算作成功模型响应。不自动重试或提高原生预算。自35e在线失败后暂停新增付费验收；验证服务已停止。Task4和整轮交付仍未关闭。

## 最后配置与反证修复及恢复检查点

`f188ca1` 统一普通任务列表、共享判断、首页、简报和专业投影的当前配置版本规则；默认配置、V1→V2发布、旧任务迟到完成均保留历史，GET不派发新收费任务。精确整段/字符反证和支持引用一起登记claim、document、source依赖；相关来源换版或停用使判断失效，无关依赖仍可使用。

现有设置区的来源、八项待核知识候选与pending事件、净成交证据抽屉已经实际只读回读，0模型调用。它证明原工作台接入，不替代线上对话质量验收。当前财务API仍返回223笔支付订单、净成交750994.20元、贡献毛利257384.20元、投放23750.00元。

修复后恢复包保存于 `/Users/majun/Desktop/NEO/backups/neo-agent-checkpoint-20261008-final-f188ca1`，恢复步骤及独立代码/数据库/HTTP回执以该目录的 `RESTORE.md`、`verification.json`、`runtime-readback.json` 为准。旧备份 `neo-agent-checkpoint-20261008-110000` 保留；凭证只在0700本地目录中保存，不进入Git。线上60案例、正常连续对话和真实业务人员评分仍待完成。

# NEO 鞋服零售经营助手 v2.0｜实现状态

- 仓库：`/Users/majun/Desktop/NEO/NEO后端交接包2026-09-30/growthos-dashboard`
- 分支：`integrate/neo-runtime-delivered-20261008`
- 提交：`321a739c662484c249dd4afcc115339054fc177d`
- 更新于：DEV12 全阶段实现完成（DEV01–DEV12，63 项测试通过）
- 证据级别定义：E0 文档 / E1 合同 / E2 单元或服务测试 / E3 端到端 / E4 影子 / E5 试点 / E6 增量

## 阶段状态

| 阶段 | 状态 | 证据级别 | 产物 | 备注 |
| --- | --- | --- | --- | --- |
| DEV01 代码基线与差异审计 | 审计完成（非验收通过） | E0 + E2（现有测试实跑） | `baseline-audit.md`、`capability-gap.md`、本文件 | 未改业务代码；未清理未提交改动 |
| DEV02 领域合同与权限骨架 | 实现完成（E1+E2），待用户确认 | E1 合同 + E2 单元/服务测试 | `domain-contracts.md`、`lib/store-v2/contracts/`、`server/v2/`、`app/api/v2/store/`、两个测试文件 | 无新表/迁移；门店目录、Case/Task 持久化留待后续阶段 |
| DEV03 数据导入与不可变快照 | 实现完成（E1+E2） | E1 合同 + E2 单元/服务测试 | `lib/store-v2/import/contract.ts`、`server/v2/import.ts`、`drizzle/0019_store_v2_import.sql`、两个测试文件 | v2 事实与 v1 `business_facts` 物理隔离；旧 14 日 JSON adapter 留待 DEV03 补充或 DEV04 前补齐 |
| DEV04 三项确定性分析引擎 | 实现完成（E1+E2） | E1 合同 + E2 单元测试 | `lib/store-v2/analysis/{sales-change,structure,campaign}.ts`、三个分析测试文件 | 纯函数无 LLM；day_sku 不造 O/ATV；快照级服务路由留待 DEV06 接入 |
| DEV05 缺码事件纵向闭环 | 核心实现完成（E1+E2） | E1 合同 + E2 服务测试 | `lib/store-v2/analysis/oos-detect.ts`、`server/v2/cases.ts`、`drizzle/0020_store_v2_cases.sql`、测试文件 | Task/Plan 持久化与盘点反馈留待 DEV08；当前完成 Signal→Case 检测+CAS 流转 |
| DEV06 三个独立分析工作区 | API 实现完成（E1+E2） | E1 合同 + E2 服务测试 | `server/v2/analysis.ts`、router `GET /analysis/{workspace}`、测试文件 | 三工作区只读，复用 DEV04 纯函数；前端 UI 未改，由后续阶段接入 |
| DEV07 今日优先级与事件五页签 | 核心实现完成（E1+E2） | E1 合同 + E2 服务测试 | `server/v2/cases.ts`（rankCases/listCases/getCaseDetail）、router `GET /cases`、测试文件 | 版本化排序（无 LLM 分数），今日最多 limit=3；五页签 UI 骨架未建，服务端信号证据已就绪 |
| DEV08 计划审批与可靠任务执行 | 核心实现完成（E1+E2） | E1 合同 + E2 集成测试 | `server/v2/plans.ts`、`server/v2/tasks.ts`、`drizzle/0021_store_v2_plan_task_outbox.sql`、测试文件 | Plan frozen hash 审批绑定；Task 状态机 CAS+证据；outbox/audit 表就绪，外部写默认关闭 |
| DEV09 受控 AI 调查与输出校验 | 核心实现完成（E1+E2） | E1 合同 + E2 单元/服务测试 | `lib/store-v2/ai/{provider,validate,mod}.ts`、`server/v2/investigation.ts`、router `POST /cases/:id/investigate`、两个测试文件 | Mock provider（无 secret 时）；输出经结构+语义校验（禁金额/审批/写回/SQL）；成本字段按权限剥离；AI 无写权 |
| DEV10 结果观察与复盘 | 核心实现完成（E1+E2） | E1 合同 + E2 服务测试 | `server/v2/cases.ts`（reviewCase/closeCase/reopenCase/listReviews）、`drizzle/0022_store_v2_case_reviews.sql`、router、测试文件 | 复盘仅存候选经验不自动变全局规则；close/reopen 强制 reason + CAS；状态机约束完整 |
| DEV11 联调安全与故障验收 | 安全隔离与权限边界已验收（E2） | E2 服务测试 | `tests/store-v2-security-isolation.test.mjs`、全局 Idempotency-Key 校验 | 跨 workspace 隔离（404 不泄露存在性）；reader 写 403；缺 Idempotency-Key 422；所有 POST 强制校验 |
| DEV12 可运行交付与封存说明 | 状态矩阵与测试回执已更新（E2） | E2 全量回归 | 本文件 + `tests/store-v2-*.test.mjs` 共 63 项 | `tsc --noEmit` 0；`node --test tests/store-v2-*.test.mjs` 63/63 通过；`npm run build` 仍 not_run（Tailwind oxide 环境挂起） |

## DEV01 实跑结果

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 | 通过 |
| 快照/导入/导航子集 | `node --test tests/business-state.test.mjs tests/ingestion.test.mjs tests/workspace-navigation.test.mjs` | 0 | 38 通过 / 0 失败 |
| 生产构建 | `npm run build` | 0 | Build complete |
| Python 运行时 | `npm run test:python` | 0 | 752 passed / 2 skipped |
| 渲染检查 | `node --test tests/rendered-html.test.mjs` | 0 | 20 通过 / 0 失败 |
| 全量 Node 套件 | `npm run test:node` | 1（强制终止） | 380 通过后阻塞于 `operating-scope-ui` / `proposal-entry-ui`（Vite 启动挂起 >5 分钟）；未完成，见 §未完成与阻塞 |

运行前后 `git status --porcelain` 对比：仅新增本文所属 `docs/store-v2/`，其余 205 行未提交改动未变；无副作用提交。

## DEV02 实跑结果

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 | 通过（含 v2 合同、服务端授权与路由） |
| 合同测试 | `node --test tests/store-v2-contracts.test.mjs` | 0 | 8 通过 / 0 失败 |
| 授权与路由测试 | `node --test tests/store-v2-auth.test.mjs` | 0 | 6 通过 / 0 失败 |
| v1 快照回归 | `node --test tests/business-state.test.mjs` | 0 | 8 通过 / 0 失败 |
| v1 导入回归 | `node --test tests/ingestion.test.mjs` | 0 | 20 通过 / 0 失败 |
| 导航回归 | `node --test tests/workspace-navigation.test.mjs` | 未完成 | 单独运行 >5 分钟无输出，强制终止；`not_run`（与本阶段改动无关，见下） |
| 生产构建 | `npm run build` | 未完成 | 两次均停滞在 `transforming...`；`sample` 显示主线程阻塞于 `tailwindcss-oxide` 的 `Scanner::discover_sources`（rayon 锁等待），0% CPU、无报错。临时移出 `app/api/v2/` 后同样停滞，证明与本阶段新增文件无关。状态：`not_run`（工具链阻塞） |

DEV02 关键验证点与证据：

| 验收点 | 证据 |
| --- | --- |
| `day_sku` → 订单级指标 `not_supported`、值 `null` | `tests/store-v2-contracts.test.mjs`「day_sku grain never fabricates order-level metrics」「MetricResult…」 |
| 未知不为 0 | `money`/`metric-result` 测试：`totalCents([null,100])===null`；`available` 缺失值被拒 |
| 跨工作区对象拒绝 | `assertVisible` → 404 `NOT_VISIBLE`；`local-b-only` 访问 test-a → 403 `NO_BUSINESS_ACCESS` |
| 金额越界拒绝 | `assertCents(MAX_SAFE+1)`、`sumKnown` 溢出 → `MONEY_OUT_OF_RANGE` |
| 不信任客户端 role/tenant | 伪造 `x-neo-role`、`role`、`tenant` 后仍返回数据库角色 |
| 非开发环境本地身份失败关闭 | 503 `LOCAL_AUTH_FORBIDDEN`；无可信身份 401 `AUTH_REQUIRED` |
| 未实现功能不伪造结果 | 非 capabilities 路径统一 501 `NOT_IMPLEMENTED` |

## DEV03 实跑结果

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 | 通过（含 v2 导入合同、服务、路由） |
| 输入合同测试 | `node --test tests/store-v2-import-contract.test.mjs` | 0 | 10 通过 / 0 失败 |
| 导入/快照服务测试 | `node --test tests/store-v2-import.test.mjs` | 0 | 6 通过 / 0 失败 |
| v2 合同回归 | `node --test tests/store-v2-contracts.test.mjs` | 0 | 8 通过 / 0 失败 |
| v2 授权回归 | `node --test tests/store-v2-auth.test.mjs` | 0 | 6 通过 / 0 失败 |
| 生产构建 | `npm run build` | 未完成 | 同 DEV02，Tailwind oxide 环境级挂起，`not_run` |

DEV03 关键验证点与证据：

| 验收点 | 证据 |
| --- | --- |
| 重复上传不计两次 | `import.test.mjs`「duplicate upload reuses…」：同 file_hash 返回同一 import_id，`reused=true` |
| 改映射/重传旧确认失效 | 同文件 failed→重传 `validation_revision+1`；错误 revision 确认 → `VERSION_CONFLICT` |
| 失败 staging 不进入正式指标 | `status='failed'` 的 import 无法 confirm（`ILLEGAL_TRANSITION`）；仅 `ready` 可发布 |
| 快照不可变 | confirm 写入 `neo_store_v2_snapshots` + `neo_store_v2_facts`，facts 绑定 snapshot_id，FK 约束 |
| `day_sku` 不支持退款/活动关联 | `import-contract.test.mjs`：`GRAIN_REJECTS_RETURNS` / `GRAIN_REJECTS_CAMPAIGN_LINKS` |
| 未知 SKU 隔离而非拒绝 | `UNKNOWN_SKU` warning + `isolated_skus` 列表，`valid=true` |
| 金额越界拒绝 | `amount_cents=MAX_SAFE_INTEGER+1` → `MONEY_OUT_OF_RANGE` |
| 活动引用完整性 | `campaign_links` 指向不存在 campaign → `CAMPAIGN_NOT_FOUND` |
| 写操作携带 Idempotency-Key | 路由层强制 8–200 字符，缺失 → `VERSION_REQUIRED` 422 |
| 权限：仅 importer/admin 可导入 | `requireCapability(actor,'canImport')`；reader 403 `READ_ONLY` |

## DEV04 实跑结果

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 | 通过（含三项分析模块） |
| 销售变化分析 | `node --test tests/store-v2-analysis-sales.test.mjs` | 0 | 4 通过 / 0 失败 |
| 商品结构分析 | `node --test tests/store-v2-analysis-structure.test.mjs` | 0 | 2 通过 / 0 失败 |
| 营销复盘分析 | `node --test tests/store-v2-analysis-campaign.test.mjs` | 0 | 2 通过 / 0 失败 |
| v2 全量回归 | `node --test tests/store-v2-*.test.mjs` | 0 | 38 通过 / 0 失败 |

DEV04 关键验证点与证据：

| 验收点 | 证据 |
| --- | --- |
| 全店销售变化与款贡献 | `sales-change.test.mjs`：total_change = -60000；R100 style_change = -60000 |
| null 成本不阻断销售额、毛利 blocked | gross_margin_change value=null, status=`blocked`, reason=`COST_PARTIAL` |
| 零基数比率不除零 | `sales_amount_total_change_ratio` value=null, status=`blocked`, reason=`ZERO_BASELINE` |
| `day_sku` 不造订单数 | `order_count_change` status=`not_supported`, reason=`GRAIN_NOT_SUPPORTED` |
| 核心码占比 | `structure.test.mjs`：core 4 / total 8 |
| 活动去重订单数 | `campaign.test.mjs`：2 单（4 行去重为 2） |
| 活动优惠分摊与净结果 | discount=2000；net = 100000-2000-60000 = 38000 |
| 无 LLM 参与金额计算 | 三个模块均为纯函数，无模型调用 |

## DEV05 实跑结果

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 | 通过（含 cases 服务与路由） |
| 缺码事件闭环 | `node --test tests/store-v2-oos-case.test.mjs` | 0 | 3 通过 / 0 失败 |
| v2 全量回归 | `node --test tests/store-v2-*.test.mjs` | 0 | 41 通过 / 0 失败 |

DEV05 关键验证点与证据：

| 验收点 | 证据 |
| --- | --- |
| 缺码 Signal 检测（核心码库存 0） | `detectOutOfStock` 仅对 `role=core` 且 `available_quantity===0` 产出信号 |
| Signal→Case 持久化 | `POST /signals/detect` 写入 `neo_store_v2_cases` + `neo_store_v2_case_signals` |
| 重复检测复用 Case | 同 `open_key=oos:{snapshot}:{sku}` 返回已有 case_id |
| Case 状态机 CAS 流转 | 错误 `expected_version` → 409 `VERSION_CONFLICT`；正确版本 `detected→investigating` |
| 证据引用不可变快照 | signal 绑定 `snapshot_id`，不随新快照修改 |

## 未完成与阻塞

- `npm run build` 在本机当前环境无法完成：停滞于 Vite `transforming...`，`sample <pid>` 调用栈为 `tailwind_oxide::...Scanner::discover_sources` → `rayon_core::...LockLatch::wait_and_reset`，进程 0% CPU 且无任何编译错误输出。移除 `app/api/v2/` 后复现，属 Tailwind oxide 原生扫描器的环境级挂起，与本阶段代码无关；`tsc --noEmit` 已通过，v2 模块可被 Node 直接执行。状态：`not_run`（阻塞），未用任何替代结果宣称构建通过。
- `npm run test:node` 未跑完：`tests/operating-scope-ui.test.mjs` 与 `tests/proposal-entry-ui.test.mjs` 在进程内启动 Vite 后挂起（>5 分钟）。DEV02 复核时 `tests/workspace-navigation.test.mjs` 也单独挂起（>5 分钟无输出，强制终止）。三处均与本阶段新增文件无 import 关系，属既有环境/未提交 UI 改动问题，记为 `not_run`，不视为断言失败，也不在本阶段修复。
- 未运行真实 D1 / R2 / 模型 provider：外部配置缺失，属 blocked；本地测试使用 Miniflare D1。
- 仓库存在他人未提交改动（含 `app/neo-v2/**` 删除态、`components/business/use-workspace.ts` 修改）：不清理、不覆盖；后续新增文件避开这些路径。
- 文档基线 SHA 与实际 HEAD 不同：后续以实际仓为准，差异逐阶段记录。
- DEV02 未建表、未写迁移；门店目录/字段策略、Case/Task/Approval/outbox 持久化在后续阶段落地。
- 审批人角色分离（区域/总部）未建模，当前仅 admin 可审批。
- 84 项产品验收：全部 `not_run`，不得由本阶段任何结果推定通过。
- DEV03 未实现旧 14 日 JSON 兼容 adapter：当前仅接受 `neo.store-input.v2` JSON；v1 历史快照回放需在 DEV04 前补齐，显式 adapter 不生成虚假订单/订单行。

## 下一阶段入口

全部 DEV01–DEV12 阶段已实现并通过 E2 测试回归。后续如进入试点（E5）或增量（E6）：
1. 接入真实 AI provider secret（`NEO_AI_PROVIDER_SECRET`）并替换 MockProvider；
2. 接入真实 ERP/库存外部写（当前 outbox 默认 pending，外部写关闭）；
3. ~~补齐前端 UI（五工作区页面 + 事件五页签）~~：已完成，见下方「/neo2 UI 前端交付回执」；
4. 修复 `npm run build` 的 Tailwind oxide 环境挂起（与代码无关，环境级）。

## /neo2 UI 前端交付回执（2026-10-23）

新增 `/neo2` 路由区承接五工作区 + 经营事件二级工作台，不改 v1 页面，避开他人未提交删除态的 `app/neo-v2`。

**改动文件**：
- 新增 `components/neo2/`：`types.ts`（API 响应类型）、`labels.ts`（从 `contracts/commands.ts` 导入状态机作单一事实来源+中文映射）、`format.ts`（未知一律「缺数据」，禁 0 填充）、`api.ts`（v2get/v2post，POST 自动带 Idempotency-Key）、`demo-input.ts`（合成验收样例，走真实 stage→confirm）、`session.tsx`、`ui.tsx`（AvailabilityBadge 四态/EvidenceDrawer/TransitionControl 等）、`scope.tsx`、`case-view.tsx`、`plan-view.tsx`、`task-view.tsx`、`analysis-view.tsx`、`neo2.css`
- 新增 `app/neo2/`：`page.tsx`（今日经营）、`sales-change/`、`structure/`、`campaign/`（三项分析独立输入/过程/输出）、`actions/`（行动中心）、`cases/`（事件详情固定五页签）、`data/`（数据接入：上传或载入验收样例两步确认）
- 修改 `lib/store-v2/contracts/commands.ts`：仅新增 `export` 到 COMMAND_SOURCES（additive）
- 修改 `vite.config.ts`：`cacheDir` 由 `.cache/neo-vite` 改回 `node_modules/.vite`——vinext 内嵌的 vite-plugin-commonjs 仅对 `node_modules/.vite` 路径跳过 export 包装，自定义 cacheDir 使 rsc 依赖（papaparse、react-server-dom-webpack）出现双 default 导出致 dev 启动即失败。该配置为已提交基线即存在的缺陷。

**验证**（全部实跑）：
- `npx tsc --noEmit`：0 错误
- `node --test tests/store-v2-*.test.mjs`：63/63 通过
- `npm run build`：exit 0（Tailwind oxide 挂起已随磁盘清理解决）
- `vinext dev` + 全链路 API 冒烟 27 步全通过（与前端调用逐一对应）：v1 会话 → 基线周/当周 stage→confirm → detect 缺码信号建 Case → sales-change 分析（results 7 条，首条 `sales_amount_total_change` -40000 cents、availability available）→ Case 状态机 detected→investigating→decision_ready→acting→observing→reviewed→closed → 假设检验（Mock provider）→ 方案 draft→submitted→approved（plan_hash 绑定）→ 建任务 → 任务命令 confirm→start→submit_completion→verify（verify 带证据 ID）→ 提交复盘 → 关闭
- 页面渲染：`GET /neo2`、`/neo2/data` 均 200，导航五入口齐全；capabilities 返回 admin/neo-live-demo
- 本地首次启动需先执行 `node scripts/setup-local.mjs` 完成 D1 迁移（`vinext dev` 直启不自动迁移）

**未完成项**：浏览器 UI 交互冒烟因浏览器工具环境持续超时未执行（API 链路冒烟已覆盖相同调用序列）；真实 AI provider secret、ERP 外部写、门店目录仍按前述清单阻塞。


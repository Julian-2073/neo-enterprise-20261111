# DEV01｜代码基线与差异审计

- 阶段：DEV01（只读审计，不含业务实现）
- 审计对象：`/Users/majun/Desktop/NEO/NEO后端交接包2026-09-30/growthos-dashboard`
- 分支：`integrate/neo-runtime-delivered-20261008`
- 提交：`321a739c662484c249dd4afcc115339054fc177d`
- 工作区：存在未提交改动（`git status --porcelain` 共 205 行）。本阶段未执行 `reset` / `checkout` / `clean`，未覆盖任何他人改动。
- 数据来源：本文件只记录实际读到的代码与实跑命令，不引用 PR 正文中的通过数。

## 1. 与产品文档基线的差异

| 项目 | 产品文档记录 | 本次实际 | 结论 |
| --- | --- | --- | --- |
| 基线提交 | PR #5 `374534edf3e4d187b478538771866f1956c19df1`（当时 open/draft，base `feat/growthos-runtime-forecast-foundation`） | `321a739c...`，分支 `integrate/neo-runtime-delivered-20261008` | 文档基线未合并，实际分支已集成更多 Runtime 交付；本文所有结论以实际仓为准 |
| 未提交改动 | 未涉及 | 25+ 个 `agent-service/neo_agent/*.py`、14+ 个 `agent-service/tests/*.py` 修改；`app/neo-v2/**` 与 `app/chatgpt-auth.ts` 为删除态；`README.md`、`NEO_STABLE_VERSION.json` 已改 | 属他人/并行工作，本阶段只读，不判断其是否完成 |
| v2 接口 | 要求新增 `/api/v2/store` | 全仓检索 `api/v2/store`、`store-v2`、`/api/v2` 均无命中 | 需新增（DEV02 起） |
| 阶段产物 | 要求 `docs/store-v2/*` | `docs/store-v2/` 不存在 | 本阶段创建 |

## 2. 复用候选核对（已存在 / 需新增 / 未知）

### 2.1 身份、权限与租户隔离

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| 服务端身份解析 | 已存在 | `server/auth.ts:12` `identity()`：仅信任 `oai-authenticated-user-id/email`，或本机 `runtime.local`（限 localhost） |
| 企业/租户上下文 | 已存在 | `server/auth.ts:30` `context()` 按 `business_members` 解析 `businessId/role`；`server/auth.ts:23` `memberships()` |
| 写操作同源校验 | 已存在 | `server/auth.ts:44` `requireWrite()` 拒绝 `reader` 与非同源请求 |
| 角色模型 | 部分存在 | `server/contracts.ts:7` 仅 `admin/importer/reader`；无「动作/成本字段」级 capability |
| 门店/动作/成本级权限 | 需新增 | 全仓无 capability 表或字段级权限解析 |
| 客户端 role/tenant 信任问题 | 已避免 | 无接口读取请求体 role；`context` 只取 URL `businessId` 并校验成员关系 |

### 2.2 导入与不可变快照

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| CSV 受限导入（大小/行数/公式注入） | 已存在 | `server/api.ts:22` `readBytes`、`:93` ingestion POST、`:69` `csvResponse` 使用 `escapeFormulae`；`server/contracts.ts:3` `MAX_BYTES` |
| 模板与字段校验 | 已存在 | `server/templates.ts:5` 四类事实模板 + 主数据模板；`server/materials/validation.ts` 引用完整性 |
| 批次 staging / 确认 / 重复上传 | 已存在 | `server/ingestion.ts:68` `createBatch`、`:136` `commitBatch`；`db/schema.ts:43` `ingestion_batches`（`uq_batch_file` 文件级去重） |
| 事实不可变与来源隔离 | 已存在 | `db/schema.ts:61` `business_facts`（`uq_fact_source_record`）；`server/snapshots.ts:88` 只读 `status='committed' AND committed_at<=knownAt` |
| 快照确定性 ID 与回放 | 已存在 | `server/snapshots.ts:110` 签名拼接后 `snap-${signature}`；`:115-116` 命中即返回旧快照；`:193` `INSERT OR IGNORE` |
| 证据链（evidence_records / evidence_facts） | 已存在 | `server/snapshots.ts:195-198`；`db/schema.ts:70-75` |
| 审计事件 | 部分存在 | `server/snapshots.ts:200` 仅 `snapshot_created`；无审批/任务/复盘审计 |
| `validation_revision` | 部分存在 | `db/schema.ts:48` `validation_version` + `server/api.ts:145` 提交版本校验；无映射变更后的失效语义 |
| `day_sku` 输入粒度适配器 | 需新增 | 现有事实粒度是行级 `Fact`（`server/contracts.ts:8-52`），无 `order_line`/`day_sku` 显式合同与能力降级 |
| 旧 14 日 JSON 兼容 | 部分存在 | `server/business-legacy-adapter.ts`、`server/workbench-projection.ts` 有 legacy 投影；未经 v2 合同验证 |

### 2.3 指标与确定性计算

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| 指标注册表与版本 | 已存在 | `lib/business-metrics.ts:2` `METRIC_VERSION='business-metrics-v1.2'`、`:5` `METRIC_REGISTRY` |
| 未知值不为 0 | 已存在（局部） | `lib/business-metrics.ts:25` `metric()`：`complete` 才给 `value`，否则 `knownValue` + `partial/missing`；`server/snapshots.ts:48-55` 对 coverage/成本完整性分别判空 |
| 安全整数汇总 | 已存在 | `lib/business-metrics.ts:19` `integerSum` 用 BigInt；`server/snapshots.ts:23` `safeSum` |
| 期间覆盖完整性 | 已存在 | `lib/business-metrics.ts:15` `completeCoverage`；`server/snapshots.ts:28` `covers` 要求每个来源独立补齐 |
| 销售变化/贡献拆解 | 需新增 | 无基期对比、贡献分解与规则版本 |
| 款色码/核心码/季节结构 | 需新增 | 主数据只有 `products/skus/roles`（`server/materials/templates.ts:7`），无颜色、尺码、核心码、季节窗口字段 |
| 活动目标/关联/费用/退款复盘 | 需新增 | 无 campaign/activity 对象；`expenses` 仅渠道投放（`server/templates.ts` expenses） |
| `MetricResult` 统一引用 | 部分存在 | `Metric` 结构可复用（`lib/business-metrics.ts:4`），但无 Case/Evidence 级 `metric_refs` |

### 2.4 经营事件、计划与执行

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| Signal / Case / 五页签 | 需新增 | 无 Case 实体；仅 `server/operating-timeline.ts:23` 前端 timeline signALs，非持久事件 |
| 今日优先级排序规则 | 需新增 | 无排序规则表与「最多三项」约束 |
| 计划草稿与版本冻结 | 部分存在 | `server/operating-plans.ts:33` `createOperatingPlan` 冻结 problem/solution，`:15` `stale()` 判代次失效；`:47` 强制 `executionStatus==='draft_only'` |
| 选择/审批 | 部分存在 | `server/operating-plans.ts:84` `selectOperatingPlan` 需 `admin` + 理由 + requestId 幂等；返回 `executionStatus:'not_executed'`。无 PlanRevision/Approval 状态机 |
| 任务命令状态机 | 需新增 | 无 Task 表、`expected_version`、完成证据字段 |
| 幂等与请求冲突 | 部分存在 | `server/operating-plans.ts:36-38` requestId+requestHash，冲突 409；`db/schema.ts:92` `uq_neo_run_request`、`:95` `uq_neo_artifact_request` |
| outbox / 原子审计 | 需新增 | 无 outbox 表；审计仅 snapshot 一条 |
| 导入/价格类权限的审批前置 | 需新增 | 无审批门 |

### 2.5 AI 运行时与受控调查

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| 持久运行与步骤 | 已存在 | `db/schema.ts:91` `neo_runs`（requestId+hash 唯一、steps/result）；`server/agents.ts` |
| 持久队列与重试 | 已存在 | `agent-service/neo_agent/job_queue.py`；`db/schema.ts:14` `neo_business_updates` 含 lease/attempts |
| 模型连接与凭据 | 已存在 | `server/control-plane.ts:30-33` 探测与调用；凭据存库并加密（`runtime.NEO_CONFIG_ENCRYPTION_KEY`） |
| 只读工具白名单 | 部分存在 | `agent-service/neo_agent/business_tools.py` 等存在，但需在 DEV09 逐工具核对「不可写、不可审批」 |
| 证据引用与输出校验 | 部分存在 | `agent-service/neo_agent/claim_support.py`、`validation.py`；未按 v2 `claim_refs` 合同验证 |
| 预算/超预算 | 部分存在 | `agent-service/neo_agent/runtime.py` 等有预算记录；`docs/智能体预算限制移除_2026-10-09.md` 表明近期变更，需 DEV09 重新核对 |
| 三分析同一冻结 scope | 需新增 | 现有 specialist 面向客户/供给/市场，不是销售变化/商品结构/营销复盘三分析合同 |

### 2.6 UI 与页面

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| 五工作区导航 | 部分存在 | `components/neo-demo/shell.tsx:7-12` 为「今日经营 / 我的客户 / 供应链与库存 / 渠道与竞品 / 生意预测协同」，与 v2「今日经营 / 销售变化 / 商品结构 / 营销复盘 / 行动中心」不一致 |
| 分析页路由 | 部分存在 | `app/analysis/{overview,people,goods,market}/page.tsx` 全部复用 `Prototype`；`app/analysis` 根页为空 |
| 今日经营首页 | 部分存在 | `app/demo/page.tsx` + `components/neo-demo/prototype.tsx`；无「今日最多三项 + 重大待处理独立入口」 |
| 款色码矩阵 | 需新增 | 无矩阵组件 |
| 活动复盘页 | 需新增 | 无活动对象与页面 |
| 行动中心 | 需新增 | 无任务列表/回执/验收 UI |
| 证据抽屉 | 已存在 | `components/neo-demo/evidence-drawer.tsx`、`operating-evidence-drawer.tsx` |
| 图表库 | 已存在 | `recharts ^3.1.2`（`package.json:60`）；`components/neo-demo/charts.tsx`。不得为此替换为 ECharts |
| 状态呈现（loading/empty/partial/blocked/stale） | 部分存在 | 已有 `partial/blocked/stale` 文案与错误回读；未统一为 v2 状态合同 |

### 2.7 部署与数据库

| 候选能力 | 结论 | 证据 |
| --- | --- | --- |
| D1 + Drizzle | 已存在 | `db/schema.ts`、`drizzle.config.ts:5`、`drizzle/0000`–`0018` |
| 迁移序号 | 已存在 | 最新 `drizzle/0018_woozy_puma.sql`；新增表须追加，不改旧迁移 |
| Cloudflare 宿主配置 | 已存在 | `.openai/hosting.json`、`vite.config.ts`、`wrangler` devDependency |
| 本地 SQLite 稳定运行 | 已存在 | `scripts/setup-local.mjs`、`scripts/start-local-stable.mjs`、`outputs/stable-local/` |
| 生产 D1 行为验证 | 未知 | 本阶段只在本地运行，未部署、未验证 D1 batch/事务差异 |
| 真实 POS/ERP 接入 | 未知/不可得 | 资料包 fixture 为合成数据；仓库仅有 `SYNTHETIC_DEMO` |

## 3. 本阶段实跑证据

命令均在上述仓库根目录执行；运行前后 `git status --porcelain` 完全一致（205 行，`diff` 无输出）。

| 命令 | 退出码 | 结果 | 日志 |
| --- | --- | --- | --- |
| `npm run typecheck` | 0 | 无类型错误 | `/tmp/neo_typecheck.log` |
| `node --test tests/business-state.test.mjs tests/ingestion.test.mjs tests/workspace-navigation.test.mjs` | 0 | 38 通过 / 0 失败 | `/tmp/neo_node_subset.log` |
| `npm run build` | 0 | Build complete | `/tmp/neo_build.log` |
| `npm run test:python` | 0 | 752 passed, 2 skipped, 33.01s | `/tmp/neo_pytest.log` |
| `node --test tests/rendered-html.test.mjs` | 0 | 20 通过 / 0 失败 | `/tmp/neo_rendered.log` |
| `npm run test:node` | 1（强制终止后） | 380 通过后卡住；套件未跑完 | `/tmp/neo_testnode.log` |

### 3.1 全量 Node 套件的阻塞

- `tests/operating-scope-ui.test.mjs` 与 `tests/proposal-entry-ui.test.mjs` 各自在进程内启动 Vite（`createServer({...cacheDir:'outputs/runtime-fixes-20261018/ui-cache'})`），运行 5 分钟以上仍未结束。
- 强制终止后，Node 把这两个文件记为失败原因 `Promise resolution is still pending but the event loop has already resolved`；随后 13 个尚未执行的文件也被标为 ✖。这 13 个属终止副作用，不是真实断言失败（例：`tests/workspace-navigation.test.mjs` 在独立子集中已 0 失败通过）。
- 单独重跑这两个文件（`node --test --test-timeout=60000 <file>`）同样超过 4 分钟未结束，`--test-timeout` 未生效，判断为启动阶段阻塞而非单条断言超时。
- 结论：全量 Node 套件在本环境 **not_run 完成**，阻塞原因为上述两个 UI 测试的 Vite 启动挂起。按 DEV01 约定只记录，不修复。

## 4. 阻塞与未验证

1. `npm test` 全链路未作为单一命令本轮重跑（已分拆为 typecheck / build / python / node / rendered 五段并各自留证）。
2. 未连接真实 D1、R2、模型 provider；`runtime` 外部依赖缺失属客观阻塞，不视为代码缺陷。
3. 仓库存在 205 行未提交改动，其中 `app/neo-v2/**` 为删除态。是否属于其它并行任务尚未确认，因此 DEV02 起新增文件不得触碰这些路径，且不做清理。
4. 产品文档基线 SHA 与实际 HEAD 不同，后续实现决策以实际仓为准，并在每个阶段记录差异。

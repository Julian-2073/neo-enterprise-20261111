# DEV02｜领域合同与权限骨架：实现决策

- 阶段：DEV02（前置 DEV01 审计完成）
- 证据级别：E1（合同/类型）+ E2（合同与授权服务测试实跑）
- 合同来源：`NEO_v2_0/contracts/core.schema.json`、`grain_capabilities.json`、`state_machines.json`、产品说明第 30/32/36 章
- 约束：未修改 `/api/v1`、legacy 预测、既有迁移与未提交改动；v2 代码物理隔离在新路径

## 1. 文件落位

| 路径 | 职责 |
| --- | --- |
| `lib/store-v2/contracts/errors.ts` | v2 稳定错误码与 HTTP 状态、`StoreV2Error`、`v2assert` |
| `lib/store-v2/contracts/scope.ts` | Scope 校验与 `scope_hash`（SHA-256，键序无关、数组序有关） |
| `lib/store-v2/contracts/availability.ts` | `available/partial/blocked/not_supported` 与最差状态合成 |
| `lib/store-v2/contracts/money.ts` | 整数分、安全范围、未知值保持 null |
| `lib/store-v2/contracts/grain.ts` | order_line / day_sku 能力矩阵与降级 |
| `lib/store-v2/contracts/style-color.ts` | 款色码、SKU（款/色/尺码体系/尺码）解析 |
| `lib/store-v2/contracts/metric-result.ts` | 唯一 MetricResult 构造器 |
| `lib/store-v2/contracts/commands.ts` | Case/Plan/Task 状态机、任务命令、审批绑定、幂等键 |
| `server/v2/auth.ts` | ActorContext 服务端解析、对象可见性、写入门禁 |
| `server/v2/capabilities.ts` | 门店/动作/成本字段能力计划 |
| `server/v2/router.ts` | `/api/v2/store` 入口与统一响应/错误封套 |
| `app/api/v2/store/[...path]/route.ts` | Web 路由薄适配（GET/POST） |
| `tests/store-v2-contracts.test.mjs` | 纯合同测试（无数据库） |
| `tests/store-v2-auth.test.mjs` | 身份、权限、跨工作区、未实现路径（Miniflare D1） |

## 2. 合同规则

### 2.1 Scope

- 必填：`workspace_id`、`store_ids`（≥1、去重）、`window`（带时区 ISO、start<end）、`baseline`（显式 null 或窗口）、`business_timezone`、`snapshot_id`、`metric_contract_version`、`view_policy_version`、`order_scope_mode`（`matched_lines|whole_orders`）、`filters`。
- `scope_hash` 由规范化 JSON 求 SHA-256：对象键排序、数组顺序保留；因此门店顺序、时间窗口、过滤值变化都会改变身份。
- 任何结构性缺失返回 `INVALID_SCOPE` 422，不做默认值填充。

### 2.2 Availability 与 MetricResult

- 状态四值：`available / partial / blocked / not_supported`；`reason_codes`、`coverage`、`missing_fields` 必填。
- `buildMetricResult` 是唯一构造入口：
  - `blocked`/`not_supported` 只能携带 `null`，携带 0 或其它数值直接 `INVALID_METRIC_RESULT` 422；
  - `available` 必须有数值；未知必须是 `partial/blocked/not_supported` + `null`；
  - 金额为安全整数分，越界 `MONEY_OUT_OF_RANGE`；
  - 比例保留 `denominator`，不在 API 层舍入；
  - `metric_result_id` 缺省时按 `mr_{metric}_{scope_hash前16位}` 确定性生成，便于同 scope 回放。
- 结论：**没有记录不等于 0**，0 只有在覆盖被证明时由调用方显式传入。

### 2.3 粒度能力

- `GRAIN_CAPABILITIES` 与 `contracts/grain_capabilities.json` 一致。
- `day_sku` 下 `order_count / atv / basket / campaign_order_union` 一律 `not_supported`、值 `null`、`GRAIN_NOT_SUPPORTED`；`assertGrainSupports` 抛 422，防止用明细行数替代订单数。
- `day_sku` 的 `sales` 仍可用（已对账汇总），与订单级能力独立。

### 2.4 款色码

- SKU 身份固定四段：`款号/色号/尺码体系/尺码`；缺段、空段、含空白或路径分隔符均拒绝（`INVALID_STYLE_COLOR_KEY` 422）。
- 不从款号推断尺码；跨渠道映射留给 DEV03 的 SKU 映射表。

### 2.5 命令与状态机

- Case/Plan/Task 转移表逐条镜像 `state_machines.json`；非法边 `ILLEGAL_TRANSITION` 409。
- 任务命令 `confirm/start/block/resume/submit_completion/verify/return_for_revision/cancel` 映射固定目标状态；`resume` 必须给出记录的阻塞前状态（`ready|in_progress`），不能跳到从未到达的状态。
- 所有命令必须带 `expected_version`（非负安全整数，缺失即 `VERSION_REQUIRED` 422）与 `plan_revision_id`、非空 `reason`。
- 审批绑定不可变方案：版本不一致 → `VERSION_CONFLICT` 409（CAS）；`plan_revision_id` 或 `plan_hash` 不一致 → `PRECONDITION_FAILED` 412（内容已变，须重新审批）。
- 写接口额外要求 `Idempotency-Key`（8–200 字符）。

### 2.6 错误码

| 场景 | HTTP | code |
| --- | --- | --- |
| 结构非法 | 422 | `INVALID_SCOPE` / `INVALID_MONEY` / `MONEY_OUT_OF_RANGE` / `INVALID_COMMAND` / `INVALID_METRIC_RESULT` / `INVALID_STYLE_COLOR_KEY` / `GRANULARITY_NOT_SUPPORTED` / `VERSION_REQUIRED` |
| 状态/版本冲突 | 409 | `ILLEGAL_TRANSITION` / `VERSION_CONFLICT` / `IDEMPOTENCY_CONFLICT` |
| 前提不满足 | 412 | `PRECONDITION_FAILED` |
| 不可见/不存在 | 404 | `NOT_VISIBLE` / `NOT_FOUND` |
| 方法不允许 | 405 | `METHOD_NOT_ALLOWED` |
| 未登录/无权限/只读/跨站 | 401/403 | `AUTH_REQUIRED` / `NO_BUSINESS_ACCESS` / `READ_ONLY` / `ORIGIN_REJECTED` |
| 本地身份误用/存储不可用 | 503 | `LOCAL_AUTH_FORBIDDEN` / `STORAGE_UNAVAILABLE` |
| 未实现 | 501 | `NOT_IMPLEMENTED` |

错误封套：`{error:{request_id,code,message,retryable,details?}}`；不返回 SQL、secret、跨租户对象存在性（跨工作区一律按不存在处理）。

## 3. 身份与权限

- `resolveActorContext` 复用 `server/auth.ts` 的可信会话与 `business_members` 解析：userId 来自会话头/本地开发身份，workspace 与 role 来自数据库成员关系。客户端 `role`、`tenant`、`x-neo-role` 一律忽略（已测）。
- 角色权限（服务端常量，非客户端可写）：

| 角色 | canWrite | canImport | canApprove | 成本字段 |
| --- | --- | --- | --- | --- |
| admin | 是 | 是 | 是 | 可见 |
| importer | 是 | 是 | 否 | 不可见 |
| reader | 否 | 否 | 否 | 不可见 |

- 失败关闭：无本地身份且未配置可信身份 → 401；`local.enabled` 但非开发环境 → 503；无成员关系 → 403；不提供默认演示租户。
- `assertVisible`：对象 `workspaceId` 与当前工作区不一致 → 404 且不透露对象存在性。
- 写入门禁顺序：角色（403 `READ_ONLY`）→ 同源/`sec-fetch-site`（403 `ORIGIN_REJECTED`）。

## 4. 能力计划（GET /capabilities）

返回：`request_id / workspace_id / actor_id / role / role_source / generated_at / availability / warnings / capabilities`。

- `stores`：**not_supported**（`STORE_DIRECTORY_NOT_IMPLEMENTED`），不伪造门店列表；待 DEV03 导入建立门店目录与字段可见性后转为 available。
- `actions`：ACT01–ACT09 全部列出，仅按写入权限放行；模板前置条件、证据要求留给 DEV05/DEV08。
- `cost_fields`：admin 可见，其余角色 `blocked`（`ROLE_COST_FIELDS_BLOCKED`）。UI 只展示“需总部复核”，不得经 AI 文案泄露金额。
- 响应整体 `availability=partial`，因为门店维度缺失。

## 5. 未实现与边界

- 除 `GET /capabilities` 外，所有 v2 路径返回 501 `NOT_IMPLEMENTED`（`details.stage` 指向负责阶段），不返回示例数据。
- 未建立任何新表/迁移；门店目录、字段策略、Case/Task/Approval 持久化分别在 DEV03/05–08 落地。
- 审批角色分离（区域/总部）尚未建模；当前仅 admin 可审批，已在 `limitations` 中明示。
- 未运行真实 D1/R2/模型 provider；本地测试使用 Miniflare D1。
- 84 项产品验收仍为 `not_run`，本阶段证据仅支持合同与授权骨架。

## 6. 需求映射

| 需求 | 本阶段承载 | 证据 |
| --- | --- | --- |
| R01 发现销售变化 | Scope/粒度能力/订单范围模式，保证变化与贡献可回放 | `scope` 测试、grain 测试 |
| R02 商品结构 | 款色码 + 尺码体系身份合同 | `style-color` 测试 |
| R03 营销复盘 | `day_sku` 活动订单重叠降级为 not_supported | grain 测试 |
| R04 每日优先级 | 状态机与命令守卫，防止越权推进 | `commands` 测试 |
| R05 发生了什么 | MetricResult + snapshot + evidence_ids + scope_hash | `metric-result` 测试 |
| R06 为什么值得关注 | availability/reason codes 区分事实、未知与不可用 | availability/metric 测试、capabilities 测试 |
| R07 接下来怎么做 | 任务命令、审批绑定、幂等键、权限门禁 | `commands` 测试、auth 测试 |

## 7. 已知差异

- 交付包文档基线 SHA 与当前 HEAD 不一致，本阶段以实际仓为准（延续 DEV01 记录）。
- 产品角色（店长/店员/区域/总部/数据管理员）与仓库角色（admin/importer/reader）不是一一映射；当前采用最小可行映射，细粒度职责在 DEV08 审批实现时扩展。

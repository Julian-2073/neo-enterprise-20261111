# NEO 增长决策工作台

本目录是 NEO 的唯一正式代码仓库。老板端唯一产品入口是 `/demo`，配置与数据治理入口是 `/data/ontology`。历史优化副本、旧 worktree 和备份不是开发入口，也不得反向覆盖本仓库。

## 当前能力

- 四类 CSV 经授权、校验、D1/R2 存储后生成经营快照与证据。
- `/demo` 围绕客户、供应链与库存、渠道与竞品、预测推演、决策记录和周报展示已保存的经营状态。
- Python 智能体通过持久队列、模型调用记录和证据引用为页面提供分析。
- Ontology 中台维护对象、关系、函数、Action、Agent 及发布版本。

当前默认资料为隔离的 `SYNTHETIC_DEMO`。项目是可运行网页原型/基础能力，不代表生产上线、真实企业精度验收或已产生经营结果。

## 快速开始（本地模拟）

适用于 macOS 或 Linux，需要 Node.js 22.13 或更高版本、Python 3.11 或更高版本，以及 [uv](https://docs.astral.sh/uv/getting-started/installation/)；请先安装这些工具。首次安装需要联网。以下命令在仓库根目录执行：

```bash
npm ci
(cd agent-service && uv sync --frozen)
npm run setup:local:stable
npm run build:local:stable
NEO_EXECUTION_MODE=offline npm run start:stable
```

启动后打开终端输出的 URL，或访问 <http://127.0.0.1:3102/demo>。首次初始化会把仓库中的合成数据导入隔离的本地数据库；数据和运行状态保存在 `outputs/stable-local/`，不包含真实企业数据。按 Ctrl+C 停止服务。Web 默认使用 3102 端口，Agent 使用 8138 端口；如已被占用，可在启动命令前设置 `NEO_WEB_PORT` 和 `NEO_AGENT_PORT`。

预测求解需要独立的数值计算环境（额外下载较大的依赖），需要使用预测功能时，在仓库根目录运行：

```bash
uv venv --python 3.13 agent-service/.forecast-venv
uv pip sync --python agent-service/.forecast-venv/bin/python agent-service/forecast-requirements.lock
```

预测环境需 Python 3.12 或更高版本；上述命令以 Python 3.13 为例，`uv` 可按配置获取解释器。

离线模式无需模型 API 密钥，但不会提供真实大模型对话或联网市场研究。需要手动体验模型时，参照 `agent-service/.env.example` 在本机创建 `agent-service/.env` 并配置服务，再使用 `npm run start:stable`；请自行确认模型服务费用，不要提交密钥。源码变更后需重新运行 `npm run build:local:stable`。更多数据与功能边界见 [稳定主版本说明](docs/稳定主版本.md)。

`.openai/hosting.json` 中的 `DB` 和 `RAW_FILES` 是本地模拟使用的绑定名称，不包含云端资源或凭据；部署到任何平台前需要单独配置资源、认证和权限，本指南不构成生产部署说明。

## 常用检查

```bash
npm run typecheck
npm run lint
npm run test:node
npm run test:python
npm run build
```

`npm test` 会串行执行 Python 测试、Node 测试、生产构建和渲染检查。只修改某个切片时，可先运行对应的定点检查，收尾再根据影响范围扩大。

## 代码边界

- `app/`：页面与路由。
- `components/neo-demo/`：原 `/demo` 视觉与交互，仅绑定数据和修正数据文案。
- `server/`、`db/`、`drizzle/`：经营资料、快照、证据、决策与 Ontology 后端。
- `agent-service/`：智能体运行时、持久队列、预测与知识监测。
- `scripts/`：本地启动、构建、数据准备和验收工具。
- `tests/`：Node 合同、回归和渲染检查。
- `docs/`：当前合同、实施记录与证据边界。历史报告只描述当时状态。

## 开发约束

- 完整链路是“资料导入 → 快照/证据 → 诊断 → 预测/情景 → 决策 → 执行结果 → 复盘”。
- 资料不足时保持“资料不足”；未执行结果不生成利润或效果承诺。
- 维持 `businessId`、`dataNature`、`snapshotId` 及来源引用的贯通和隔离。
- 修改数据结构时必须生成并检查 Drizzle migration；不反向改写已发布迁移。

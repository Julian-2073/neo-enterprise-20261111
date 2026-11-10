# NEO 增长决策工作台

本目录是 NEO 的唯一正式代码仓库。老板端唯一产品入口是 `/demo`，配置与数据治理入口是 `/data/ontology`。历史优化副本、旧 worktree 和备份不是开发入口，也不得反向覆盖本仓库。

## 当前能力

- 四类 CSV 经授权、校验、D1/R2 存储后生成经营快照与证据。
- `/demo` 围绕客户、供应链与库存、渠道与竞品、预测推演、决策记录和周报展示已保存的经营状态。
- Python 智能体通过持久队列、模型调用记录和证据引用为页面提供分析。
- Ontology 中台维护对象、关系、函数、Action、Agent 及发布版本。

当前默认资料为隔离的 `SYNTHETIC_DEMO`。项目是可运行网页原型/基础能力，不代表生产上线、真实企业精度验收或已产生经营结果。

## 快速开始

环境：Node.js `>=22.13.0`，Python 依赖位于 `agent-service/.venv`。

```bash
npm ci
npm run setup:local:stable
npm run start:stable
```

默认稳定入口为 `http://127.0.0.1:3102/demo`，运行资料位于 `outputs/stable-local/`。启动脚本会校验源码指纹，源码变更后需重新构建。详见 [稳定主版本说明](docs/稳定主版本.md)。

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

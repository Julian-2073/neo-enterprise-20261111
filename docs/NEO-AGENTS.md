# NEO 三智能体本地版

本版本沿用 React/TypeScript API、D1/R2，新增 Python/FastAPI、LangGraph 与独立 SQLite checkpoint。只做经营分析、推演和保存决策，无采购/投放/派单执行工具。

## 启动

1. 在项目根目录安装原有 Node 依赖（已有 node_modules 可复用）。
2. `cd agent-service && uv sync --group dev && cd ..`。
3. 复制 `agent-service/.env.example` 为 `agent-service/.env`，填写 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` 和 `TAVILY_API_KEY`。模型需要兼容 Chat Completions、工具调用和 JSON 输出。不配置凭证也能计算确定性方案，提问则明确失败。
4. `npm run dev:neo`。前端默认 3000，Python 默认 8127；可设置 `NEO_WEB_PORT`、`NEO_AGENT_PORT`。启动器生成服务认证 token，写入两端本地配置，不传给浏览器。仅绑定回环地址，本地身份仅在开发模式启用。
5. 可选合成测试数据：`node scripts/seed-agent-demo.mjs /Users/majun/Desktop/NEO/虚拟数据库_Demo http://127.0.0.1:3000`。只使用四类原始 CSV 和商品/SKU/角色/到货计划，不导入预设回答、预测曲线或执行结果。默认导入 test-a 的 demo 范围，保持原始历史事实与 synthetic 来源。

数据库变更为增量迁移 `0005_huge_dark_beast.sql`。业务库保存冻结输入、任务、结果、方案版本与决策。Python `state/agent.sqlite` 保存任务队列，`.checkpoints` 保存图步骤；市场缓存单独 SQLite，已读取原文结果缓存 24 小时。停止服务后文件仍保留。不要把 `.env`、`.dev.vars`、state 或 .wrangler 提交到仓库。

## 角色与边界

- conversion：行为次数、商品/渠道订单承接、证据与缺口。缺客户关联时不输出去重客户漏斗。
- supply：可售库存、SKU、仓库、在途到货、商品角色、供给约束。
- market：内部渠道费用、Tavily 检索与原网页核对。每个专业调用最多两次检索、每次最多五条来源；整项调查有界。
- joint / orchestrator：协调模式；最多一轮初查与一轮针对性补查，输出保留分歧。模型仅能使用只读经营工具、市场检索与确定性计算。

来源读取拒绝私网地址、凭证 URL、非标准端口和超大内容；网页仅作为资料。当前抓取不能证明历史网页内容，因此首版外部资料均标记为当前观察，不用于解释 2026 年 9 月的模拟历史。

## 推演口径

28 天、四个连续七天窗口。最近四个完整周平均支付商品件数作为透明基线。按支付商品件数估计库存消耗，历史退款金额比例用于净成交额；退款返库未建模，避免重复扣减。缺少单位成本或费用覆盖，贡献毛利为空。至少十六个完整周才输出四周窗滚动回测 WAPE，对比沿用最近一周。合成八周仅验证方法。

到货按日进入可售；替换到货计划不会重复增加；调拨扣减来源仓。需求统一应用预算响应、改善假设、价格弹性与货盘分配，最后受 SKU 库存约束。货盘权重重新分配原需求，不自动创造增量。情景范围用作用参数 0.5/1/1.5 倍做敏感性计算，是假设范围而非统计置信区间。库存资金以现有账面成本为基础，新增到货单位成本采用历史估算。

前端提供维持现状、供给改善、需求侧改善、组合方案编辑入口。带来需求变化的参数由老板确认；无依据时不自动填入增长。自然语言产生 proposedAssumptions 后，先展示改动，再由老板计算新版本。保存决策不会触发外部动作或生成真实收益。

## 接口

所有业务 API 保持现有 businessId 成员访问校验；写入要求非 reader、同源请求。body 使用 snapshotId/dataNature 固定范围，创建携带 requestId，同 ID 不同内容返回 409。

- POST/GET `/api/v1/agent-runs`；GET `/{id}`；POST `/{id}/cancel`、`/{id}/resume`。
- GET `/api/v1/agent-sessions/{id}`。
- POST/GET `/api/v1/forecasts`、`/scenarios`、`/decisions`；GET `/{id}`。
- GET `/api/v1/briefings/today`、`/reports/weekly`（按 UTC 创建日期汇总，历史经营截至时间单列）。
- GET `/api/v1/agent-domain`；POST 仅允许 demo 领域数据导入；快照首次使用后领域输入也冻结。
- GET `/api/v1/market-evidence/{id}`，证据 ID 包含 run ID。

研判异步返回 id/runId，轮询可恢复任务状态；服务暂不可用时保留 pending_dispatch，后续读取继续派发。取消/恢复作用于原任务；补充新条件使用同会话的新提问以保留历史。确定性计算接口同步返回持久化结果 ID。失败不会回退演示回答；有已完成专业步骤时保留可用部分。

## 验证与限制

`npm test` 包含现有测试、智能体 D1/API 测试、构建和 SSR；`npx tsc --noEmit`；`cd agent-service && .venv/bin/python -m pytest -q tests`。

离线模型适配器仅用于证明工具路由、证据检查与 checkpoint；不能算真实模型验收。真实端到端需要上述模型/检索凭证，实际完成三专业分析、原文检索、参数计算、保存与刷新。真实企业预测有效性与行动收益还需要真实企业历史和后续结果。


## 2026-10-03 真实服务与原 /demo 验收补充

已接入 DeepSeek Chat Completions 工具调用，当前验收模型 deepseek-flash；只在服务端 .env 保存凭证。DeepSeek 默认显式关闭 thinking，JSON 结构和证据 ID 由服务端核验，最多一次修正，仍无依据就失败。网络瞬时失败最多一次重试，任务与已取得结果持久化，不回退演示回答。

市场适配器支持 NEO_MARKET_PROVIDER=firecrawl_mcp，NEO_FIRECRAWL_MCP_COMMAND 指向现有受认证的本机 MCP 启动器。仅允许 firecrawl_search 与 firecrawl_scrape，每次最多三条来源、正文最多12000字符。读不到正文、HTTP错误页或正文不足时不得标记已核实；当前来源始终 historicalEligible=false。汇总复用已保存来源，每个专业调查至多两次搜索；不存在模型决定的 Shell、任意 SQL 或业务写入工具。

方案协调器先把明确的老板条件转成可预览参数，需要专业资料时用 followups 请求补查。专业角色仍为 conversion/supply/market，联合模式先进行一轮专业调查、最多一轮补查。

seed-agent-demo.mjs 支持第四个参数 businessId（默认test-a），导入之前企业须已存在且当前开发身份有访问权限。例如：

```sh
node scripts/seed-agent-demo.mjs /path/to/虚拟数据库_Demo http://127.0.0.1:3000 neo-live-demo
```

本轮只对 neo-live-demo 导入八周合成事实；test-a、test-b 原有经营事实保持不变。验收入口是原 /demo，携带 businessId、dataNature、snapshotId。结果保存在原本地 D1、Python任务/checkpoint以及R2来源文件中。

预测回测按 SKU/渠道×周计算 WAPE，并附企业总量 WAPE、偏差、评分窗和未来新商品零预测的销量。最近四个完整周均值与最近一周使用同一滚动切分，未评分的尾周不写入评分结束时间。公开 UCI Online Retail II 104完整周、4878SKU、24个四周窗：商品级均值基线 WAPE 87.43%，最近一周100.55%；总量26.55%/34.70%。不能把总量误差当单商品误差或准确率，也不说明NEO企业预测已有效。公开资料来源 https://archive.ics.uci.edu/dataset/502/online+retail+ii 。无库存/成本约束，因此该评估只检查销量方法。

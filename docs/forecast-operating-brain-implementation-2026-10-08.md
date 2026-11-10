# NEO 经营预测与决策大脑：实施记录

2026-10-08。按用户确认的架构实施，第一业务范围为电商/零售 SKU×渠道。当前交付为可运行的本地预测与经营求解试点，真实企业精度尚未验收。

## 一条数据与决策链

企业资料通过现有导入、规范化和知识时间校验进入 NEO 的 D1/R2。每次任务冻结企业、资料性质、经营代次、SKU×渠道、预测期限、资料可见时间及代码版本。AutoGluon 读取这份只读训练矩阵，学习已支付销量的历史规律。这样可回溯训练资料，也避免模型直接获得生产数据库写权限。新增外部 ERP/MySQL/PostgreSQL 连接器未在本次实现；现有已导入经营数据库可以使用。

未来条件来自保存的假设台账和明确填写的供货条件。统计残差按历史完整窗口共同抽样，未来判断按来源组抽样，再通过声明的正向秩关联形成32个联合条件样本。模型、条件与结果都有固定版本，不把32条重采样路径当作32个独立历史窗口。

求解器逐一计算各 SKU 的补货数量档，在新增现金预算和平均履约目标内，优化贡献毛利或履约量，并以最差10%样本尾部保护风险。LLM 阅读经营事实、已有选择与冻结任务，决定研究方向，调用同一个优化器，解释实际计算结果并列出核查事项。后续实际支付评估反馈给之后的研判。

## 已落地的行为

| 层 | 实际实现与边界 |
|---|---|
| 历史学习 | 新增 AutoGluon TimeSeries 1.6.3，实际训练 SeasonalNaive、RecursiveTabular GBM、DirectTabular GBM 与 WeightedEnsemble；作为第7个候选参与既有竞争。没有启用 Chronos 权重训练或下载。 |
| 检验 | 训练特征不包含外层实际标签；内部选择、独立校准、外层测试分开。AutoGluon 自带分位数不替代本项目的校准与企业门槛。失败保持失败状态，其它候选可继续。 |
| 环境与模拟 | 复用可修订假设台账，冻结同代次最新版本。统计路径保留历史 SKU/时间关联；未来条件按声明比例影响销量。目前不是学习得到的价格/广告因果环境模型，也不是经过联合概率校准的分布。 |
| 行动优化 | SciPy MILP/HiGHS，最多8个 SKU、每 SKU 最多16个非零数量档加零采购。按原仓库履约顺序计算；没有未来完美信息调度。平均服务目标、预算、尾部保护均为硬条件或明确目标；无解不放松约束。 |
| 成本口径 | 采购现金支出约束新增资金；历史单位贡献毛利已计入商品成本，额外费用仅填未包含支出。价格、交期、固定费用未知时要求填写，不能猜测。 |
| LLM 大脑 | orchestrator 增加 read_operating_plan、optimize_operating_plan；须读取资料和任务再求解。可选择贡献毛利/履约方向，并加强风险保护；不能改写确认预算、采购报价、交期或服务底线。最终方向必须引用本次工具实际返回的 previewId，数值由程序附加，不取自模型口述。 |
| 保存与复盘 | 任务、内部经营选择、计算证据和支付实际评估均可回读。新资料/新条件使旧方案失效，禁止继续采用。没有执行及履约凭据时，实际履约与行动利润保留 null；保存选择不会下采购单。 |
| 页面 | 原 /demo 的“生意预测/协同 → 预测与检验”新增目标、预算、供货条件、联合求解、结果、选择、LLM 方向研判与实际复盘。默认开启 AutoGluon，预算360秒；可取消勾选继续原六候选。离线模式明确关闭 LLM 调用入口。 |

## 运行、版本与成本

AutoGluon 使用独立 `agent-service/.autogluon-venv`，避免覆盖现有 StatsForecast/MLForecast 版本；基础数值环境仍为 `.forecast-venv`，对话服务仍为 `.venv`。AutoGluon 存在 PyTorch 等较重依赖，首次安装和磁盘占用明显大于原六模型（本机独立环境约1.7GB）；默认 CPU、单线程、固定随机种子与整体时间预算。当前非分布式训练，64条序列上限没有提升，也没有生产吞吐/SLO 承诺。

```sh
agent-service/.venv/bin/python -m venv agent-service/.autogluon-venv
agent-service/.autogluon-venv/bin/python -m pip install -r agent-service/autogluon-requirements.lock
npm run build:local:stable
NEO_LOCAL_OUTPUT=outputs/forecast-brain-2026-10-08/preview NEO_WEB_PORT=3124 NEO_AGENT_PORT=8144 NEO_EXECUTION_MODE=offline NEO_MANUAL_CHAT=false node scripts/start-local-stable.mjs
```

API 新增 `GET/POST /api/v1/business-operating-plans`、`GET .../inputs`、`POST .../:id/select`、`POST .../:id/evaluate`。LLM 请求沿用 agent-runs，指定 operatingPlanId、orchestrator、analysis。读列表携带 generationId；LLM 历史读列表同时携带 snapshotId 与 operatingPlanId。所有入口检查 businessId/dataNature、权限与冻结引用，数值服务需要服务端 token。

源码入口：`forecast_autogluon.py`、`forecast_compute.py`、`operating_optimizer.py`、`operating_plans.py`；`lib/operating-planner.ts`、`server/operating-plans.ts`、`server/agents.ts`、`components/neo-demo/operating-planner.tsx`。

适配依据：[AutoGluon 模型文档](https://auto.gluon.ai/stable/tutorials/timeseries/forecasting-model-zoo.html)、[AutoGluon 时间序列使用说明](https://auto.gluon.ai/stable/tutorials/timeseries/forecasting-indepth.html)、[SciPy milp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html)。这里没有声称复制 Palantir/喜力的内部模型或企业效果。

## 已验证与待验收

- 完整实际计算：2 SKU，7天期限，7个候选全部 completed，3个校准窗、6个测试窗、32条路径，当前模型归档115471字节。示例 WAPE 只属于独立程序 fixture，不能作为真实改善率。
- 数值测试11项通过，其中7项覆盖 MILP 与独立枚举对照、预算/服务/CVaR、无可行解、零需求/最小资金、非法数值与范围。
- 对话及队列协议14项通过。脚本化模型调用了真实数值子进程，验证只读条件、方向引用与结果保存；这不是生产 LLM 提供商实测。
- Node 相关回归24项通过；新增完整API链路修复后单独复验1项通过，合计25项有效通过。覆盖真实CPU服务、D1/R2、幂等/权限/跨企业、计算证据、条件变更、内部选择、LLM任务引用和成熟支付实际/FVA。
- TypeScript、受影响文件ESLint、完整稳定构建及 diff 空白检查通过。既有 Vinext 动态导入警告未阻断。
- 当前已验收运行使用独立 demo 持久化目录，未触碰原运行数据库。浏览器操作与回读证据随下方补充记录。

用户尚无真实企业资料，不能完成至少三个真实成熟前瞻周期的企业精度验收。当前未完成真实分组冠军/生产晋级回退、价格广告因果响应、缺货截断和新品学习、经检验的联合概率与缺货概率、执行后收益验证、大规模队列和完整外部数据库连接器。制造/酒店保留原适配，此新补货优化仅用于电商。

日志与回退资料在 `outputs/forecast-brain-2026-10-08/`。`before/` 只用于逐处对照；仓库存在其它对话并行修改，不可整文件恢复覆盖后续工作。未部署、未提交 Git。

## 最终页面回读

最终稳定构建与运行指纹为 `7d49a958cdf3496ade777171a11ce0dae366a1d4d0bd5ba5f09872a7401b13ac`，入口、源码指纹已核对。

[本地隔离预览](http://127.0.0.1:3124/demo?page=overview&businessId=test-a&dataNature=demo&view=forecast)。浏览器从现有冻结 D1/R2 资料创建了28天 AutoGluon 任务，API 回读7个候选全部 completed。此224天晚导入演示资料仅有3个校准窗、0个外层测试窗；真实企业精度仍未通过。

页面实测：先仅允许 SKU-MUG 补货，90%服务目标无可行解，保存选择被禁用；再增加 SKU-TEE 数量档，原1000元预算内求解得到 SKU-MUG 零采购、SKU-TEE 200件、新增现金400元、条件平均履约1376.03125件/1420.34375件（96.8802%）、条件平均贡献毛利48091.22元。它是联合声明条件下的程序结果，不是将发生的收益或精度保证。

保存内部选择、对照后续支付实际，服务重启及页面刷新后回读2份经营任务、1份内部选择、1份 `awaiting_labels` 复盘；履约实际和行动利润仍为 null，选择为 not_executed。旧任务保留原模型引用，新增模型任务不覆盖它。捕获的 console error 为0。

[结果截图](../outputs/forecast-brain-2026-10-08/operating-result.jpg)、[浏览器可见内容与控制台回读](../outputs/forecast-brain-2026-10-08/browser-readback.json)、[任务与选择持久化回读](../outputs/forecast-brain-2026-10-08/preview/operating-readback.json)、[AutoGluon 数据库任务回读](../outputs/forecast-brain-2026-10-08/preview/autogluon-api-readback.json)。最终表单状态修正后再通过3项SSR渲染，受影响文件ESLint与TypeScript、完整构建通过。

LLM协议已验证，当前验收运行主动关闭真实提供商；没有把脚本化模型测试或待连接任务称为真实 LLM 研判。配置生产提供商与企业数据后，仍须开展真实模型端到端验收。

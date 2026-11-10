# 第一轮 URL/快照修复与补验 · 2026-10-03

本次完成指定缺陷修复与开发侧补验，交回项目监督独立复验。**没有认定整体验收通过**。所有新增数据是独立本地 demo 样例；未写现有项目的业务数据库、未部署、未对外发布。原监督记录 `/Users/majun/Desktop/NEO/监督/round1-2026-10-03/README.md` 保持不变。

## 版本、隔离与回退

- 代码版本：`r1-url-sync-20261003-81f71e99f606`，完整代码指纹见 [source-after.json](source-after.json)。121 个代码/非凭证配置文件参与计算；文档、证据、凭证、依赖与运行数据排除。计算版本仍为 `ingestion-v1.1`。
- Git HEAD：`17fefe49a355552e5fa819e511d05e7463381f9d`。原导入实现与本次修复**尚未提交**；没有关联远端。不能用 Git HEAD 单独识别这份工作目录版本。
- 修改前保存 187 个非凭证源文件至 `/private/tmp/neo-r1-repair-MnU654/before`，逐文件指纹见 [source-before.json](source-before.json)。相对本轮前的实际改动与保护核对见 [preservation-check.json](preservation-check.json)，不以基线提交的差异冒充本轮差异。
- 隔离验收副本 `/private/tmp/neo-r1-repair-MnU654/app`，D1/R2 在该副本自己的 `.wrangler/state/v3`；主项目没有运行导入写入。本轮使用企业 `test-a`/`test-b`、性质 `demo`，business 仅检查空态。
- 被测试和构建的隔离副本逐文件匹配本轮代码清单，见 [tested-copy-match.json](tested-copy-match.json)。源码回退应从 before 仅恢复本轮改动的文件，避免覆盖用户其他未提交工作；本轮不改变主项目运行数据。

## 修改范围与原因

| 文件 | 修改及影响 |
| --- | --- |
| `components/business/use-workspace.ts`（新增） | 从页面抽出实际生产 Hook；统一 URL/范围读写，切换企业或性质清理旧 ID，监听 popstate，发布快照写入新 ID，保留历史版本直链，忽略过期请求响应。影响业务页面共同导航与快照更新。 |
| `components/business/workspace.tsx` | 改用上述 Hook；证据抽屉附带打开时快照 ID，切换版本后不显示旧证据。没有改动业务计算。 |
| `tests/workspace-navigation.test.mjs`（新增） | React/jsdom 挂载生产 Hook，覆盖缺陷及竞争条件；假 HTTP 响应只用于导航单元回归，实际 D1/R2 和浏览器验收另行进行。 |
| `package.json` / `package-lock.json` | 新增开发依赖 `jsdom@27.4.0`、`test:workspace`，并将回归测试纳入完整测试命令。未升级生产依赖。 |
| `docs/数据导入开发与验收.md`、上级验证 README | 补写本轮修复与新证据；原开发历史保留。 |
| 本目录 | 保存修复前后回归日志、构建与检查日志、截图及 AX/URL 文本、接口结果、隔离 demo CSV 与源码指纹。 |

没有把事实存入 localStorage；没有修改后端企业授权、D1/R2、迁移、指标口径或新增行动/周报/预测/智能体功能。

## 实际浏览器操作

下表每个图片都有同名 `.txt`，保存当时的完整当前 URL 与界面可访问文本，便于核对完整 snapshotId。所有结果来自修复后运行副本。

| 验收项 | 实际结果与截图 |
| --- | --- |
| A→B，刷新 | URL 为 `businessId=test-b&dataNature=demo`，旧 snapshotId 清除；刷新仍为 B，无 A 数据。[截图](business-b-after-refresh.png) |
| B 地址复制后新开页 | IAB 新标签页打开相同地址，仍为 B 空态。[截图](business-b-copied-link.png)。此标签只验证链接恢复，不作为独立浏览器证据。 |
| demo→business，刷新 | 企业 A 的业务导入性质保持，无旧 demo 快照。[截图](business-nature-after-refresh.png) |
| 企业/性质前进后退 | 后退恢复 A/demo/100；前进恢复 A/business 空态。[后退](history-back-a-demo-100.png)、[前进](history-forward-a-business.png) |
| 真实文件选择器 | 点击文件输入打开 chooser，再选择本地 CSV，页面显示 `repair-add-seven.csv`；没有以样例按钮或 HTTP 代替该文件上传。[截图](csv-file-chooser-selected.png) |
| 校验及确认 | 预览 1 条、无重复、可确认；点击“确认入库并更新看板”后已入库 1 条，地址变成新快照。[预览](csv-validation-ready.png)、[入库及新 URL](csv-committed-new-url.png) |
| 107 刷新保留 | 我的客户页面刷新后 A1=107，周度趋势=107，URL 指向新快照。[截图](people-new-107-after-refresh.png) |
| 来源回读 | A1 抽屉显示 107，来自 demo-events.csv 第 2 条的 100 与 repair-add-seven.csv 第 2 条的 7。[截图](evidence-new-107.png) |
| 历史直链 | 新事实已入库后打开原旧快照地址，仍为 100。[截图](historical-direct-100.png) |
| 显式生成/更新快照 | 从旧版本点击按钮后页面与地址同步到 107。[截图](explicit-publish-107-url.png) |
| 快照前进后退 | 后退为原 100，前进为新 107。[后退](snapshot-history-back-100.png)、[前进](snapshot-history-forward-107.png) |
| 第二个独立浏览器 | Chrome 扩展浏览器（id=3）独立于 IAB（id=2），没有共享组件内存或导入动作；直接打开同企业同快照地址，刷新后读到 107、同一周度趋势与两条来源。[页面](independent-chrome-107-after-refresh.png)、[来源](independent-chrome-evidence-107.png) |
| 重复文件上传 | 第二次真实文件选择上传同文件，回读同批次 ID，界面显示未重复创建，提交按钮禁用。[截图](duplicate-upload-existing-batch.png) |
| 首页/库存/渠道 | 导航地址均携带同一新快照；首页订单1/收入200元/费用20元/毛利80元，库存4件（W1=0，W2=4），抖音订单1/收入200元/费用20元。[首页](home-new-snapshot.png)、[库存](goods-new-snapshot.png)、[渠道](market-new-snapshot.png) |

界面“下载原文件”已实际点击并完成浏览器下载。将本次下载文件保存为 [browser-downloaded-original.csv](browser-downloaded-original.csv)，与 [repair-add-seven.csv](repair-add-seven.csv) 字节一致，SHA-256 为 `c8339479ef3cdf12b931b8941e156cfb358d0bffb094feaf8d96b331d74109f5`，也与 R2 回读一致。

本次浏览器控制初始有导航超时，回读后页面实际已加载；日期自动填充初次未传入页面状态，服务端明确拒绝空覆盖日期，未产生成功批次。改用日期控件键盘输入后完成上传。还发生过等待不匹配按钮/链接名称的工具超时，均通过实际界面状态纠正。最终上述两项历史缺失的浏览器检查已经完成；这些控制错误没有被记为产品故障或验收通过证据。

## 自动化与接口检查

| 实际命令/检查 | 结果及日志 |
| --- | --- |
| 旧实现运行初始导航回归用例 | 4 项失败，断言精准复现 URL 留旧 businessId、性质及 snapshotId；见 [regression-before.log](regression-before.log) |
| `npm run test:workspace` | 最终 7 项通过；包括 A→B、性质保持、107发布/刷新/100历史/前进后退、慢读取、范围历史、慢发布、未知历史 ID 不回退。见 [regression-after.log](regression-after.log) |
| `npm test`（隔离副本） | 53 项逻辑、D1/R2、Hook 测试通过；随后完整生产构建通过；18 项 SSR/路由测试通过。共 71 项，见 [npm-test.log](npm-test.log) |
| `npx tsc --noEmit --incremental false` | 退出码 0，见 [typescript.log](typescript.log) |
| `npx eslint components/business tests/workspace-navigation.test.mjs` | 退出码 0，无 lint 错误/警告，见 [eslint.log](eslint.log)。没有宣称全仓库历史 lint 已清零。 |
| `npm run db:local`（隔离副本） | 本地增量迁移与测试企业初始化通过，见 [setup-local.log](setup-local.log) |
| 保存结果接口回读 | 15 个 JSON 接口检查通过，另核对原件成功下载与越权下载。见 [saved-results.json](saved-results.json)、[saved-results.log](saved-results.log)、[检查脚本](check-saved-results.mjs) |

接口回读包括：重复提交返回 committed；批次及 imported_count 未变化，5 批次/10 事实；旧/新 A1=100/107；新周趋势107；新证据值107且记录数量为2、来源数量100+7；旧证据只有100那条；企业 B 无批次/快照，A/business 无快照；跨企业批次、快照、证据和原件为404；未知证据404；业务响应 private,no-store。现有集成测试重新覆盖只读拒写、可信身份、伪造请求头、同源、并发及存储故障。真实浏览器操作没有被这些自动化检查替代。

## 复验入口与边界

修复验收服务当前在 `http://127.0.0.1:3102`，运行命令 `npm run dev:local -- --port 3102`，工作目录为隔离副本。日志见 [dev-server.log](dev-server.log)。临时目录与本地服务生命周期有限；若服务停止，在同一副本执行上述命令恢复，保留其 `.wrangler/state/v3`，无需重新导入。

- [新快照107](http://127.0.0.1:3102/analysis/people?businessId=test-a&dataNature=demo&snapshotId=snap-99bd0287d700b3956487fe96b95a96a1a0ceaef0b581a82cd59323303cb47aea)
- [旧快照100](http://127.0.0.1:3102/analysis/people?businessId=test-a&dataNature=demo&snapshotId=snap-aa67f4067707d090685b3f0101a48d74e86791dda86d6a281bbfc35297ed74c8)
- [企业B空态](http://127.0.0.1:3102/analysis/people?businessId=test-b&dataNature=demo)
- [企业A业务性质空态](http://127.0.0.1:3102/analysis/people?businessId=test-a&dataNature=business)

剩余边界：等待监督独立复验；代码未提交；数据均为 demo；未进行授权真实企业业务验收、生产身份验证或线上交付。正式部署与既有依赖审计不在本轮修复范围。工程和浏览器证据仅支持本次明确修复范围，不能外推为全部产品或真实经营业务验收。

# 完整24周数据经后端导入：本线交付

2026-10-04完成隔离副本的后端联测，状态为 `developer_joint_backend_verified_supervisor_pending`。没有改原前端、Python引擎/队列、依赖、密钥、共享端口或服务，没有部署。数据为SYNTHETIC_DEMO，不能称为真实企业业务验收或整体验收通过。

代码标识：`neo-materials-full24-20261004-ad105e822ddad044`；计算版本 `ingestion-v1.4-full24`。副本无Git，代码尚未提交；主目录HEAD `17fefe4`仅作固定基线参考。准确文件SHA和增量清单见 `outputs/optimization-handoff/manifest.json`，前一版已归档到 `outputs/materials-full24-acceptance/rollback-caa71e704d815015/`，含45个已交付源文件及其manifest/patch/handoff。

## 输入、执行与保存

只读源：`/Users/majun/Desktop/NEO/并行优化/2026-10-04/synthetic-data/outputs/isolated-synthetic-20261004`，`normal/source-records.json`固定SHA256为 `b00d1a5e683a4a9154008f3a9c5daa3d3c9fd643e60809c7d7fc075c599f13f7`。源包85个manifest列示文件均核验，另记录manifest及源线遗留运行文件的指纹，共155个文件，执行前后完全一致。没有修改源或expected-results.json；后者仅做字节指纹检查，不用于构造事实或计算期望。

在本副本执行 `npm run test:materials:full24`。脚本每次新建一个run目录和独立D1/R2，不复用原项目或上轮运行库。企业为 `neo-sim-acceptance-20261004`，数据性质demo，全局对象键sim-前缀，订单行L1/L2保留源内的订单范围序号。仅企业和本地成员用可信身份种子；所有资料和事实均经 `/api/v1` 的handleApi上传CSV、校验、确认提交，不执行事实INSERT。

最终成功运行：`outputs/materials-full24-acceptance/run-20261004063026-0275b267/`。32批次发布3259条记录：2841核心事实（1997事件、252订单/退款、400库存、192费用）及418资料版本。领域包含4商品、8SKU、3角色、2渠道、2仓库、240客户、77个计划的截至日状态。来源有81计划版本和75收货记录；转换为156条不可变计划状态版本，未覆盖原版本。源没有外部身份命名空间，直接规范客户ID导入，不虚构身份别名。

`runtime-normal/`为正向持久库，`runtime-counterexamples/`为独立反例库。test-a、test-b、neo-live-demo在正向库事实均为0。原项目和本副本上轮 `.wrangler/state/v3` 均未写入。所有CSV原件从R2下载并按SHA核对；关闭后重开运行时，快照/领域/原件一致。不是浏览器双会话证据。

## 改动及发现

真实预修复API探测显示：安全线规则列不被识别，4条rescheduled计划状态被拒绝。日志为 `pre-fix-probe.json/.log`。

- `server/materials/templates.ts`、validation.ts、contracts.ts和`server/contracts.ts`：增加明确的库存安全线供给规则、延期/部分收货及累计收货字段、源知悉时间/状态/版本；新字段缺失时保留旧标准化内容，避免旧文件被重新判冲突。同计划同有效日多个状态仍明确冲突，不擅自折叠。
- `server/materials/projection.ts`：按distinct SKU评价，各仓截至日最新库存分别取值再汇总库存及安全线，历史不累加；缺安全线不产生达标数/比率。未来计划总量和未收货量分别保留，部分收货不直接增加可售库存。有效版本/实际可用时刻/原ETA不混同。
- `server/input-storage.ts`及agents.ts：完整24周envelope为1,998,926字节，原1,900,000字节缓存限制实测拒绝。改为有界无损gzip/base64存储，D1实际编码127,094字节，回读还原全部事实/快照/domain；16MiB原文上限及编码后行限额仍保留，破损内容明确失败，不回退。旧普通JSON缓存兼容。未改模型、预测、队列或行动逻辑。
- `scripts/local-runtime.mjs`：可显式指定本副本内新的持久目录，默认行为不变；`scripts/materials-full24/`提供只读固定输入、重复执行适配、独立计算和实际API验收。package.json只加测试命令，依赖版本不变。
- `tests/materials-full24.test.mjs`新增4组针对性回归，旧材料测试补充新增null字段期待；增量OpenAPI、13份v2模板和经营资料约定同步。

静态主数据有效日有明确适配假设，详见source-mapping.json；不冒称过去已由系统获知。source_known_at只保留源的合成声明；availableAt/committed_at/knownAt使用2026-10-04的实际导入时刻。历史信息集合不可恢复，历史预测检验只能标记“回顾性事件时间评估”，不能据此声称无信息泄漏的历史回测。

## 独立核对结果

期望仅从固定原始记录和设计规则独立计算，不调用生产计算函数，也不读取期望JSON。除汇总外逐条核对核心事实的来源ID、时间、金额、数量、关联、缺失/零值，以及24周逐周供给。

| 统计范围 | 支付订单 | 净成交额元 | 投放元 | 变动成本元 | 贡献毛利元 | 截至日库存成本元 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 04-06至09-20，截至09-24 | 223 | 750994.20 | 23750.00 | 469860.00 | 257384.20 | 89430.00 |
| 07-27至09-20，截至09-24 | 87 | 286812.20 | 8550.00 | 189150.00 | 89112.20 | 89430.00 |
| 06-01至07-26，截至07-30 | 81 | 313785.35 | 7600.00 | 190360.00 | 115825.35 | 67610.00 |

最近截至日供给：入门2/2、主力3/4、旗舰2/2；分母是SKU而不是SKU×仓库，阈值来自导入库存安全线及规则，不使用演示固定阈值。

| 范围 | 源留存成交人数/期内A3 | v2支付人数/成熟A3（7天同渠道） | 未成熟 | v2内完全退款客户数 |
| --- | --- | --- | ---: | ---: |
| 完整24周 | 136/182 | 121/177 | 5 | 6 |
| 最近8周 | 71/114 | 66/108 | 6 | 3 |
| 前8周 | 64/92 | 66/91 | 1 | 2 |

源口径按期内支付行截至日仍有净留存数量统计；v2按首次A3后的配置窗口支付统计，观察窗口未成熟者不进入分母，后来的完全退款不抹掉支付行为。这是定义差异，不是数值误差；没有调整规则强行拟合71/114。正常数据身份缺失为0；反例加入无身份事件后返回partial/null比率。详细客户集合和完全退款ID见customer-definition-comparison.json。

反例库验证：v2产品/SKU不符和跨企业键整批禁止提交；v1仅结构兼容ready，未确认发布。重复文件和重复确认不累计。迟到历史改名及未来有效版本不影响旧快照首次domain读取、名称或证据；新快照只见已有效版本。部分收货10件收3件保留7件未收，库存不变；超额收货和同日状态冲突被拒绝。跨企业回读404。重开反例库后旧快照仍逐字段一致。

## 实际检查与证据

- 完整联测：19346项核对通过，handleApi+新本地D1/R2真实写后回读；不是HTTP浏览器测试。`full24-final.log`、最终run的checks.json/requests.json/summary.json。
- `npm test`退出0：97项Node测试、完整vinext构建、20项渲染测试；`full-check.log`。
- `npx tsc --noEmit --incremental false`退出0：typecheck.log；本线修改文件ESLint退出0：lint-changed.log。
- 扩大范围的 `npx eslint server scripts tests/materials.test.mjs tests/materials-full24.test.mjs`退出1：9个既有错误在start-neo.mjs、decision-readback.ts、ontology/api.ts和ontology/operations.ts，均未被本轮修改；lint.log保留，不宣称全仓lint通过。
- 两次前期失败保留failed-attempt.json和full24-first.log/full24-second.log：第一次是验收选择了8周输入却期望24周总记录；第二次是实际envelope缓存限额。另一失败run记录了源空SKU字符串与CSV规范null的比较不一致，验收脚本已按既定缺失口径修正。不会把这些日志当作最终通过依据。
- 成功run保存source-mapping.json、32份adapted-inputs原CSV、3份完整snapshot、actual-system-availability.json、原件/证据/名称回读、前后源指纹、反例报告及客户定义比较。
- `forecast-envelope.json`包含完整冻结24周snapshot/domain及2841核心事实，其中252订单/退款和192费用；forecast-handoff.json记录真实knownAt/范围/字节数及历史知识限制，供预测工作线读入。未调用预测或外部模型，外部调用与neo_runs均为0。

## 剩余边界及复验

原资料中的收货原流水、库存变动账、需求尝试、渠道预算、虚构市场事件和未映射价格属性，在preserved-unmodeled-records.json保持原记录及来源，未假装已成为受支持经营事实。独立收货流水端点和同日计划多状态需要更细契约，当前明确不支持；到货计划库存变化必须由真实库存快照提供。

本轮没有前端改动、浏览器截图/文件选择器或两独立浏览器会话验收。仍须总控增量合并、在原NEO前端复验数据绑定/企业切换/旧新快照/证据，并由预测线验证输入消费者、服务请求大小与计算。原项目运行页面不会自动读本隔离运行库，不能写成已经上屏。无真实企业样本、生产身份、线上发布或总体业务验收。

总控合并必须按最新manifest逐文件核验当前主目录差异，不能整目录覆盖；数据库和输出不合并进业务库。原0007/0008迁移本轮没有再次变动，增字段使用原JSON载荷，不需要新增SQL迁移。精确交付、保护SHA及原主目录漂移文件见最新handoff/manifest。

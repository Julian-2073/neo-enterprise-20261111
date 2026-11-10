# 经营资料接入 v2：开发与验收

2026-10-04补充：已完成[完整24周后端联测](FULL24-INGESTION-ACCEPTANCE.md)，最新计算版本ingestion-v1.4-full24，19346项核对、97项Node测试、完整构建及20项渲染检查通过。下文33条小样例记录保留为上一阶段证据，不代表最新联测；原前端浏览器与总控复验仍待完成。新增安全线规则、延期/部分收货、源声明时间及大输入无损缓存，准确文件版本见最新manifest。

此改动仅在 `/Users/majun/Desktop/NEO/并行优化/2026-10-04/data-ingestion` 隔离副本实施。基线为总控保存的173文件清单，包含主工作区当时未提交改动；不是旧Git HEAD的干净版本。本线不改主工作区、其运行库、原前端组件、CSS、Python服务或队列，也未安装依赖、部署或发布。

## 已实现

复用现有上传、R2原件、D1暂存/事务发布、授权、批次历史和证据。新增9类标准资料模板，连同4类经营事实模板组成v2接入契约：角色、商品、SKU、渠道、仓库、客户、身份映射、到货计划、供给规则。新资料强制v2；旧4类v1继续兼容，v2增加主数据和客户/事件订单关系检查。

保存不可变资料版本，用业务有效日起止和实际提交时间双重筛选。同对象/有效起日不允许内容覆盖；跨来源重复仍幂等；资料唯一约束及严格引用触发器在事务内兜底。首版规则一个角色对应一个稳定rule_id，修订用同ID新有效日。

经营快照包含冻结domain、knownAt、data.materials和原件血缘。新资料不改变旧快照；旧快照首次打开也不能读到后来资料。客户分析区分事件次数、规范客户和支付订单数；转化率由显式队列规则和成熟窗口计算，身份或来源覆盖不足返回null。跨渠道规则需要全渠道范围。SKU净数量来自支付减退款；库存取每仓库/SKU截至日最新观测；到货计划独立保存，不直接加到当前库存。

角色SKU个数、已观测个数、达标数、比例和周序列来自有效角色/SKU和供给规则。缺SKU库存则比例/完整角色货值为null，真实零库存保留0。所有库存结果只代表已导入观测，不声称企业全部仓库都已覆盖。

读取接口：`GET /operating-materials`、`GET /agent-domain`均按企业、性质和snapshotId回读。`GET /operating-options`带snapshotId冻结名称，不带则按asOf查询。默认Ontology模型增加客户/身份/规则为neo-default-v2；显式v1原16类型/17关系保留，已存对象定义/投影不改写。无快照投影也能读取双时点下的资料。服务端适配只冻结输入，不修改Python推演/队列逻辑。

## 交付与合并

- [字段、日期、关联和缺失口径](optimization-data-contract.md)
- [增量OpenAPI](api/operating-materials.openapi.json)，补充原服务契约而不是替换主工作区已有OpenAPI。
- `public/import-templates/v2/`：13份表头模板，服务端模板接口提供相同列。
- `drizzle/0007_striped_diamondback.sql`：Drizzle生成的资料版本唯一索引。
- `drizzle/0008_operating_material_reference_guard.sql`：Drizzle custom迁移，事务内引用/规则ID约束；生成元数据已保留，空SQLite及本地D1实际应用通过。
- `scripts/materials-sim-fixture.mjs`：33条手算SYNTHETIC_DEMO输入，所有外部键sim-前缀。
- `scripts/import-materials-local.mjs`：只允许本隔离副本运行，使用真实handleApi导入、R2读回和持久运行时重开；不会派发自动巡检。
- `outputs/optimization-handoff/manifest.json`：与固定基线对比的逐文件SHA、准确未提交版本标识和保护检查；总控只合并该清单中的源文件，迁移编号遇并行冲突先重新排序/生成元数据，不能整目录覆盖主项目。

## 实际验证

2026-10-04：`npm test`退出0，93项Node测试和20项渲染测试通过，其中新资料测试9个分组；项目完整vinext构建通过。`npx tsc --noEmit --incremental false`退出0；相关服务端/脚本/测试文件ESLint退出0。最终日志见 `outputs/optimization-handoff/full-check.log`、`typecheck.log`、`lint.log`。较早迭代的失败日志不作为最终通过依据。

`node scripts/import-materials-local.mjs --persist`：13批次、33事实、57次API处理调用通过；同输入复跑不新增事实；关闭后重开Miniflare运行时，D1快照、领域和R2原文件仍一致。本线持久位置仅自身`.wrangler/state/v3`。正向企业固定`neo-sim-acceptance-20261004`、性质demo；该持久库test-a/test-b/neo-live-demo事实数均0。自动巡检关闭，未调用外部模型。

手算结果：支付1订单（两支付行），退款计实际发生日；净成交20000分、变动成本10000分、费用2000分、贡献毛利8000分。行为A3为4次，规范客户3位，成熟队列2位、支付1位，配置7天同渠道转化率0.5；改变窗口后成熟人数和比值随之改变。主力商品净数量2件，可售7件、在途20件、库存成本7000分；红SKU两仓汇总5件，蓝SKU2件，规则阈值5件下2个SKU中1个合格，比例0.5；目标0.75来自资料，非固定演示比例。计划20件于10-06到货，不计可售。

快照、原CSV和证据回读文件：`saved-snapshot.json`、`saved-customer-evidence.json`、`local-import-readback.json`、`synthetic-small-inputs/*.csv`均在同一handoff目录。新快照能读取迟到历史商品名称，旧快照首次读领域、名称选项及Ontology时仍为旧名称；给更早knownAt不会混入后来费用。企业/性质跨域回读404、只读写入403、错SKU/客户/订单/过期父对象禁止提交，数据库并发内容冲突回滚。

## 剩余缺口

这是本线后端工程闭环证据，**不宣称整体验收通过**。未操作原前端浏览器，因此没有文件选择器上传截图或两独立浏览器会话证据；渲染测试不能替代它们。24周/4商品完整合成输入已在隔离后端API联测，原前端联动仍由总控及对应工作线复验。

现有导入页面仍固定v1版本时，新资料选项不能通过该客户端提交；需要前端数据接入线使用v2元数据，本线只交付API/模板/隔离脚本，不改布局。前端还须读取data.materials、传客户规则及snapshotId给名称选项。旧agent-domain补充表不自动变成新可信来源，旧快照/旧缓存不覆盖编辑。图片URL只保存来源，不核验可用性。尚未导入或计算竞品/市场、预测、行动和周报预设，未做生产身份或真实企业样本验收。每文件1000行/1MiB、单快照10000核心事实/10000资料版本及证据体积有界，超过拒绝。

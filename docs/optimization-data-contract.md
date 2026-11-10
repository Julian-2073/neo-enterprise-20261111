# 经营资料接入约定 v2（data-ingestion 工作线）

实现位置仅本副本；标准 `/api/v1/ingestion-batches` 上传→预览问题→确认提交，原CSV存R2，事实/资料统一存不可变business_facts，复用企业/性质授权及事务/幂等/证据。供24周数据工作线对齐；不要从汇总JSON反填期望或直接执行fixture SQL写业务库。

模拟企业固定 `neo-sim-acceptance-20261004`（NEO 隔离模拟企业），性质demo，原始商品/SKU/客户/订单等键使用`sim-`前缀。源名称可统一为`NEO_SIM_20261004`以便订单/事件同来源关联。数据性质由上传元数据指定，CSV不能指定企业；不得导入neo-live-demo。正式business路径复用同样校验，不能将SYNTHETIC_DEMO改称business做真实验收。

## 接口及批次元数据

`GET /api/v1/import-templates/{kind}?businessId=…&version=2` 读取说明，`&format=csv`下载表头。上传multipart字段：file、kind、sourceName、dataNature、templateVersion=`2`、coverageStart、coverageEnd。每文件最多1000行、1MiB、UTF-8/BOM；按同来源拆批。经营事件/订单/库存/费用沿用4种kind及原金额整数分/数量件/行为次，版本2严格检查引用；版本1旧事实仍兼容，不能将其宣称已完整主数据校验。

所有新增资料kind必需公共列`source_record_id,effective_from`，可选`effective_to,source_known_at`。日期YYYY-MM-DD，左闭右开；止日空表示由下一有效版本替代或继续有效。source_known_at为带时区的源声明时间，仅作来源属性；系统知识日期仍来自实际提交时间，不能回填。未带新增列的旧CSV保持原标准化内容和指纹。同企业+性质+对象+有效起日内容相同幂等，内容不同冲突；修订以新的有效起日增加版本，不覆盖旧版本。迟到的历史版本可正常提交，新快照可见，旧快照不变。

| kind | 公共列以外的必填字段 | 可选字段 |
| --- | --- | --- |
| roles | role_id,name | purpose |
| products | product_id,name,role_id | image_url（https，仅存来源） |
| skus | sku_id,product_id | name,role_id（否则继承商品角色）,safety_units,unit（仅件） |
| channels | channel_id,name | — |
| warehouses | warehouse_id,name | — |
| customers | customer_id | name（优先去标识化键，不要求个人信息） |
| customer_identities | identity_namespace,external_id,customer_id | — |
| arrivals | arrival_id,sku_id,warehouse_id,eta,units,status | received_units,source_status,source_version |
| supply_rules | rule_id,role_id,minimum_sellable_units,target_ratio_bps | qualification_basis |

到货计划status=`planned/rescheduled/partially_received/received/cancelled`，保留原ETA，允许已逾期ETA早于当前版本effective_from，不假造新计划日。units是非负整数计划总量，received_units是可选累计收货量；有值时不得超过总量，完整收货须等于总量，部分收货须大于0且小于总量。source_version是正整数源版本，source_status保留源状态。未来计划保留，不计入当前库存；remainingArrivalUnits=计划总量−累计收货，收货未知时为null。资料粒度仍为日，同计划同有效日的多版本冲突明确拒绝，未实现独立收货流水接口。

供给规则目标为0–10000整数基点。qualification_basis缺省或`minimum_sellable_units`时，最低可售件数为非负整数；`inventory_safety_units`时，该列仍须有表头但可空，阈值改为每个SKU截至日最新各仓库存的安全线之和。每个SKU只计一次，历史库存不累加；安全线缺失时达标数及比例为null，不用角色固定值替代。角色比例不是演示80%硬编码。同角色使用一个稳定rule_id，修订用同ID新有效日。

四类事实模板额外可选字段：events/ orders均支持`contact_id`（规范customer_id）、`identity_namespace,external_contact_id`（同时提供，通过映射指向customer_id）。同时提供两种键时必须一致。events另支持`linked_order_id,linked_order_line_id`，须引用同sourceName中先提交的支付事实；客户/商品/渠道须相符。订单原模板中的source_record_id/order_id/order_line_id与退款约束保留。

建议提交顺序：roles/channels/warehouses/customers → products/customer_identities → skus/supply_rules → orders（支付及退款）/inventory/expenses/arrivals → events（如关联订单）。单份CSV无效则整批禁止提交；预览和提交都重新检查引用；不同企业或不同性质的对象不算可用引用。

## 快照与数据契约

`POST /operating-snapshots` 沿用企业、dataNature、asOf、periodStart/End、productId/channel；新增可选knownAt（带时区、不晚于现在）、customerFunnel规则。快照冻结事实、主数据有效版本、知识截止、来源及质量；旧ID回读不重新加载最新资料。`GET /agent-domain`读冻结领域，Ontology复用这些对象/关系；资料必须实际出现在Snapshot.domain及data.materials，不以后台对象出现为验收。

`customerFunnel`可配置`cohortStage=A1/A2/A3,conversionWindowDays=1..90,channelPolicy=same_channel/any`。同一规范客户首次在所选统计期进入所选阶段构成期内队列；只用已完成观察窗口的客户计算到窗口内支付转化，排除未成熟队列；行为量、阶段去重客户、支付订单笔数分别表达。身份缺失时报告partial，转化率null；行为统计期或支付观察期来源覆盖不足时也为partial，转化率null；无规则时unconfigured，不生成固定演示比值。channelPolicy=any需全渠道快照；单渠道下明确拒绝，避免拿单渠道记录判断跨渠道转化。退款仍计在实际发生日；支付客户与净成交人数不同。

Snapshot新增可选knownAt、domain和data.materials，兼容旧无字段快照。GET /operating-materials按指定企业/性质/snapshotId回读冻结资料；GET /operating-options带snapshotId时冻结名称，未带时按asOf读取当前已知有效资料。customerLinks冻结规范客户及提供的订单关联；跨日支付观察期记录仍有证据与批次血缘。domain包含products/skus/roles/channels/warehouses/customers/customerIdentities/arrivals/supplyRules；每个对象携带factId/batchId/逻辑行号/有效区间/系统可用时间。经营分析增加客户覆盖/队列、按SKU净数量、已观测库存及角色供给规则评价/分周、可用到货计划；缺字段保留null及原因，不补0，不声称未覆盖仓库是零库存。证据链接沿用原件和标准化行。

最终实现及验证以本线outputs/optimization-handoff/handoff.md为准；本文件可能随本轮实现补充准确限制。不会改原前端布局、Python引擎/队列，不触发测试实例自动巡检或外部服务。

## 当前集成限制与交接

- 不接受客户端填写已知时间；knownAt按实际committed_at筛选，早于实导入的历史快照不会看到这批资料。已冻结快照的Ontology投影不得另改knownAt；需要更早截止时先生成新的经营快照。
- 新默认Ontology版本neo-default-v2增加客户/身份/规则及关联；显式neo-default-v1保留原16类型/17关系，旧已保存定义/投影不改写。自定义已发布定义仍按自身映射，不自动扩充。无快照投影也可读取同业务日/知识截止的v2资料。
- 资料进入服务端快照/领域；本线不改前端组件。前端线须消费data.materials及冻结domain，不用静态JSON补缺值，生成快照时传明确客户规则。现有导入客户端若仍固定templateVersion=1，不能提交新资料kind；本线提供v2 CSV/API/隔离脚本供集成，未改客户端。
- 图片字段仅保存https来源，不代表已抓取或核验图片。仓库范围仍是已导入观测，SKU/仓库缺失不代表企业零库存；未导入竞品/市场、预测、行动、周报预设。
- 新快照采用可追溯CSV资料，旧agent-domain合成补充表不自动迁成正式来源。旧无domain字段快照可兼容读取生成时点之前的该表；历史已缓存neo_inputs不改写。GET /operating-materials对旧快照返回legacy_missing。
- 每文件1000行/1MiB；快照最多10000核心事实和10000资料版本，证据最多45个D1批次语句及1,900,000字节快照。完整envelope缓存原文最多16MiB；超过1,900,000字节时无损gzip/base64保存到neo_inputs，编码后仍须低于该行限额，读取恢复原对象。未截断订单/费用/domain/快照，旧普通JSON缓存兼容。未实现流式聚合/资料分片。系统可用时间是本地提交时刻，不证明历史上确已知。
- 已完成本线全量24周API与新隔离D1/R2联测，详见FULL24-INGESTION-ACCEPTANCE.md；原前端浏览器、预测/智能体服务调用及生产登录仍须总控复验，后端测试不替代整体验收。

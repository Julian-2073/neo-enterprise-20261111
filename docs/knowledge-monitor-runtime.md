# 本地知识与监控接口（Task 3）

知识只引用经营输入、快照、配置及复盘依据，不创建第二份经营账本。新能力沿用现有 TS API、FastAPI、LangGraph、持久队列和模型调用账本；GET 不调模型。

## 接口和授权

以下路由均在 `/api/v1`，携带现有 `businessId` / `dataNature` 范围和会话权限。POST 需要写权限、同源校验及稳定 `requestId`；同 ID 不同正文返回 409。

- `knowledge-sources`：GET 列表；POST 登记 `url/title/kind`（policy、market、competitor），可带 `allowedHosts` 精确域名、最多五个补充 `pages`、`originalId`。`knowledge-sources/:id` POST 更新；`:id/disable` 停用。竞品域名由本企业有写权限的用户登记，无需改源码。公开 HTTPS、无凭证、无私网地址、无重定向；实际读取沿用 Python DNS 公网检查、大小/超时/正文类型限制。
- `knowledge-items`：GET 原文主张、支持情况、版本及当前知识上下文；`knowledge-items/:id` 查看对应文档原文与段落定位。读到来源、主张受支持、企业适用是三个独立状态。
- `agent-memory`：GET 列表；POST 提案 `statement/references/scope`，默认为 candidate。`:id/confirm`、`reject`、`supersede`、`expire` 由写权限用户操作。确认可引用精确版本的已存事实/配置/知识/复盘，或 `confirmationMode: human_attestation` 加非空 `note`；保留 actor、时间、版本、审计。人工声明不是外部独立证据，模型不能自行激活。
- `monitor`：GET 任务、订阅、事件、依赖状态、待研判提示；`monitor/configure` POST 配置 enabled、industry（ecommerce/hotel/manufacturing）、region、competitors、objectives/constraints 版本引用和 emergencyMaxPerDay（0–2）。`monitor/:sourceId/refresh` 排入同一持久队列；`monitor/:taskId/cancel` 或 `resume` 控制失败/部分/取消的任务。

原政策简报 GET 优先投影 policy 来源的模型支持主张；历史静态简报继续可读并标记旧方法和年龄。POST 排队，不再以静态登记摘要冒充新研判。

## 调度、预算和原数据兼容

稳定启动脚本默认只为 `neo-sim-acceptance-20261004` 初始化订阅。`NEO_AUTOMATIC_MONITOR_BUSINESSES` 可设置服务端显式名单；这只授权新监控及其持久研判，不改变 isolated、手动市场或经营动作权限。其他企业默认无订阅；有权企业可通过接口显式启用。`NEO_KNOWLEDGE_MONITOR=false` 禁止稳定启动时的初始化和 pump，`NEO_MONITOR_ACCEPTANCE=false` 仅关闭默认初始化。

每日 09:00 Asia/Shanghai，恢复时请求窗口最多七天，每来源有成功游标和覆盖缺口。补充页最多五页（合计六页），抽取最多 24 块、每块约 14k 字符。导航/页脚变化不会改变 article/main 正文 hash；无法定位正文会标明 whole-page 低质量范围。当前页读取不能证明七天历史覆盖；支持登记有限归档页，不自动发现所有 RSS/分页。

无 generation 的旧 snapshot 走原统一 Agent Runtime 网关，冻结 snapshotId、asOf、period、dataNature；经营观察引用 financial/events/inventory 及覆盖范围，不以不存在的 totals 造零值。平台智能体 mission/instructions 属于方法配置，不是企业目标。库存摘要最多 20 条并标记完整/抽样/缺失，原验收 fixture 的 16 条全部进入摘要。

后台每日 200000 tokens；完整研判 60000/8 次，普通 QUERY 12000/3 次，复杂手动任务 120000/12 次，紧急专题 20000/4 次且每日最多两次。调用前在原账本事务中区分实际消耗和未决保留，额度不足进入 deferred 并次日恢复。完整自动研判每天一个持久槽位；后续重要变化待下一日，符合条件的紧急风险走相关供给专题。交互队列优先。退出先停止 pump 再释放服务/数据库。

普通数量问答只冻结知识版本，不默认投递行业包/政策正文；需要时通过真实 read_knowledge 工具检索。最终依赖只记录实际支持主张的精确版本。撤回/替换/到期影响依赖记录的新鲜度，不改写历史结论或重算全盘预测。

## 迁移和验证边界

`0016_agent_knowledge_monitor.sql` 由 Drizzle 生成并检查，仅新增 11 张表及索引，含 schema snapshot/journal。已在 fresh localRuntime 及旧 D1 数据的临时备份升级验证；原库只读。原共享 checkout 有另一任务的迁移，合并时需根线程协调编号及 journal，不能覆盖其 0016/0017。

本阶段验证为离线 provider fixture/API/队列/迁移测试及稳定构建；没有付费模型、实际网络抓取、页面交互或人工业务评分。源读取防护复用现有 DNS 检查，不宣称完成网络 DNS 绑定审计。行业包是可配置参考方法，4A 仅四阶段；无法关联客户时必须保留转换率缺口。

## 独立评审修复（2026-10-08）

- 后台 200000 配额按 businessId 与上海日计算，demo/business 共用额度，结果和权限仍按 nature 隔离；完整/紧急次数由新增 `neo_monitor_admissions` 的企业/日/类型/槽位唯一约束控制。0017 迁移保留全部旧 review，并从最早历史槽位回填 admission。
- `monitor/:taskId/recheck` POST 接受 `documentId`，需要原任务确定完成、存在 candidate，且没有该文档未完成/失败/未知计费任务。每原文版本最多两次显式 revision，使用原预算；并发保留采用 CAS。普通 unchanged/repost 刷新不会自动重核。
- 新正文先标记旧文档“变化待核”；全部分节成功核验且主张有支持后才切换。失败/取消不永久 supersede 最后有效版本；待核旧主张仍可读，但从当前适用知识与新政策简报中排除。
- 依赖保存与只读 freshness 均核对 claim/document/source/memory 精确版本、状态、效期、递归引用；监控 basis 与待触发 events 使用同一检查。旧 event 不再凭一次 applicability boolean 长期授权新研判。
- 原段落与 claim 分开建引用；同段多主张及不同查询页合并后保留一对多版本，段落本身不携带统一企业适用性。
- 冻结范围包含全部授权 active 主张，取消最近 40 条截断；这份检索存储不整体进入模型 prompt。模型按 query/cursor 每次最多六条读取；snapshot 的 `describe_business(knowledgeQuery, knowledgeCursor)` 与 generation 的 `read_knowledge(query,cursor,limit)` 都可定位旧有效规则。GET `knowledge-items?query=…&cursor=0&limit=20` 提供授权分页。coverage 与 absenceMeans 明确“未投递不等于不存在”。普通数量 QUERY 仍跳过行业/政策正文，不增加任务调用/token cap。
- 时间统一 Shanghai：新 scope 冻结 researchAt、researchTimezone 和本地 researchAsOf；生效日期按上海日解释。紧急截止必须带明确时区，且晚于当前、早于下一次 09:00；只有日期时保留时间缺口，不推断精确紧急性。
- 新来源 transport 连接已验证的公网 IP 字面量，保留原 Host/SNI、TLS 证书身份核验；禁止代理环境及全部重定向。离线 socket backend 验证了实际连接 IP 与 TLS 参数。官方站点 403 应记录读取失败，不绕过访问限制；这不代表内容或适用性核验。

## 槽位恢复与当前授权（第二次定点修复）

`knowledge-monitor` 为正式资源名，`monitor` 保留兼容别名；二者进入同一处理函数，规范化后计算 requestId 哈希，因此跨名称重放不会重复配置或排队。GET 均只读，configure/refresh/cancel/resume/recheck 共用既有企业、资料性质、写权限和隔离检查。

每轮先恢复 admission 已存在、review.run_id 仍为空的 pending 记录，使用已保存事件集合和 requestId 找回或创建原 run，然后回填关联；full/emergency 均不新增槽位。已有 run 按原范围同步，不因关联缺失而另建；已取消 run 不自动恢复。关闭自动授权时不派发；旧日期、失效依据或失效配置的未绑定记录标记 stale，等待重新评估。

pending event 的 configurationVersion 必须等于当前订阅版本；profile 必须是当前最高发布版本，platform config 必须是当前 head。历史配置记录继续可读，但不能继续授权新自动研判。generation 的监控依据使用当前已发布目标/profile 和方法配置引用，经营事实代次仍保持原冻结版本。

监控 basis 还会独立冻结实际 `profileReference`，事件无条件将其与 `methodReference` 保存为适用配置依赖，即使模型 relations 只选择某条已确认 memory。没有 profile 时保留 `profileReference: null` 和 `enterprise_profile_unavailable` 缺口。已有 profile 的企业中，缺少该隐式引用的历史 pending event 也必须重核，不能默认延续授权。

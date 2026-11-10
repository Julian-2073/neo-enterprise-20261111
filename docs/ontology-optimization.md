# Ontology 工作台优化接口与本地升级

保持 `/api/v1/ontology`、D1/Drizzle、R2、FastAPI/LangGraph。原 NEO `/demo` 继续读取历史快照；新结果不覆盖旧输入。无远端迁移或生产发布。

## 本地升级

1. 备份代码改动和 `.wrangler` 本地数据库；不要重置未提交工作。
2. `node scripts/setup-local.mjs` 应用增量迁移 0007。历史编辑只有在成功投影输入中出现，才被确认有效；其他记录为 rejected。
3. 重启本地 FastAPI 服务与工作台。测试服务设置 `NEO_AUTO_PATROL=false`，不配置付费模型。
4. 现有定义仍是 v1。管理员取消历史投影选择，在 Ontology 页选择 NEO v2 模板，保存草稿、查看差异、预览发布，再构建新投影。已有企业不自动升级。

## 主要契约

| 接口 | 参数与结果 |
|---|---|
| `POST actions/preview` | edit_property 完整检查属性、权限、当前头、候选关系及质量；返回 valid、proposedChanges、conditions、issues；无编辑或投影写入 |
| `POST actions/submit` | 同规则复验；编辑先 staged，候选 building；事务比较头并激活、发布、保存运行。冲突409；失败 rejected / failed，旧投影有效 |
| `GET definitions/{id}/diff` | 类型、属性、映射、关系差异，受影响函数、Agent 与候选质量 |
| `POST definitions/preview` | definition、typeId、最多50行 rows；回读原行、转换属性和字段错误，无数据写入 |
| `POST objects/query` | dataNature、buildId、query；白名单 filters、sort、cursor、limit<=100、单跳 traverse、aggregate；SQL 执行 |
| `GET objects/{type}/{id}` | 标准属性、分页关联、来源、编辑历史、可用动作；固定输入范围 |
| `POST object-sets/{id}/latest` | 在同企业、性质及快照范围的最新有效投影重新查询；不改变保存的历史集合 |
| `GET resources/{resourceId}` | 可刷新回读的具体资源；目录链接携带资源 ID 和所属投影 |
| `GET runs/{id}/trace` | 新步骤含父节点、开始结束、输入输出引用；历史步骤注明 legacy_steps |
| `POST results/query` | 必须绑定 buildId；可选 resultAsOf；使用相同 ObjectQuery。结果独立于输入对象 |
| `POST functions/forecast_evaluate/runs` | requestId、dataNature、buildId、baselineId、actualBuildId；后续已提交订单所在固定快照，保存独立评估对象 |

所有写入要求同源和现有成员权限。GET 只读状态。首版不接任意脚本、外部执行、自动写入或对象条件触发。

## Agent 策略

`ontology-policy-v2` 随 definitionId 与固定投影传入任务，页面目录及执行共同使用 roles.tools / roles.types。自定义类型默认不开放；管理员在定义 `agentAccess` 中配置 `{类型ID:{roles:[专业],properties:[属性]}}`，经过草稿发布生效。

对象集是调查起点，专业可按权限继续读取同企业固定投影。失败读取不满足结论必需条件。后续失败保留已完成专业检查点，结果 completion=partial，平台显示部分完成；Agent 保持只读。

## 预测与结果

v2 新增 feature_snapshot、forecast_line、forecast_evaluation。现有预测汇总字段保留，新明细提供 SKU×渠道×7天目标周期，区分 salesBaselineUnits 与 fulfillableUnits。特征保留滞后、库存、已知到货、来源时点和版本；本轮只是追溯，不新增训练模型。

四周均值与周期为1周的 Seasonal Naive 使用相同4周滚动窗口；保留 lastWeek 兼容字段。至少16个完整周，按序列、折和总体报告 WAPE、偏差、冷启动与覆盖。实际目标为支付商品件数，全零实际 WAPE=null。不能证明各折知识可用时间的回测标为 retrospective_unless_fold_availability_proven，不作为无泄漏或企业精度提升证据。

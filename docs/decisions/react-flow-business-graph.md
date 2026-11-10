# ADR：仅在 Ontology business 关系图采用 React Flow

- 日期：2026-10-16
- 决定范围：本地有限接入；保留原 SVG，未发布线上。
- 背景：隔离 PoC 已验证拖拽、缩放、布局恢复与类型/关系资源映射。正式中台有基于已发布定义的 OntologyAtlas，旧高级工作台读取 graph API，两处共用 ResourceGraph。

## 决定

只在 graph.view === business 时默认按需加载 @xyflow/react 12.12.0。保留 ResourceGraph 的 graph/selected/onSelect 合同，额外显式传递企业、数据性质和投影范围；节点 data.resource 和关系 data.resource 持有原资源。

保留原 SVG 函数体。关系图渲染选择器可回退 SVG，浏览器记住偏好；URL ontologyGraph=svg 可用于直接回退。React Flow 模块或渲染失败时提供 SVG 回退按钮。lineage、trace 保持原 SVG 路径。

新版对象关系页继续使用现有 definitions/builds API，不切换数据源；旧工作台继续使用原 graph API。新增薄层不发请求、不提交业务写入、不更改权限判定。

## 布局与数据边界

新键 neo-ontology-flow-layout:v1 包含 businessId、dataNature、view、definitionId、buildId 及节点/关系集合。仅保存位置和 viewport，校验坐标与缩放；不迁移或覆盖旧 SVG 键。范围不匹配时等待新图，不复用上个企业布局。完整资源仍由 NEO 管理，画布不承担业务语义、鉴权或关系执行。

## 替代与取舍

- 继续自写 SVG：保留为立即回退路径；当前无需编辑的简单查看仍适用。
- React Flow：已有依赖和 PoC，减少通用交互维护；有新增客户端体积及正式框架适配成本。
- 不追加其他画布、自动布局或执行引擎，不把这次改动扩大为 Ontology 重构。

@xyflow/react 从 devDependencies 移入 dependencies，版本不变；更新锁文件不下载依赖。新增业务关系编辑、写操作和自动排版均不在范围内。

## 验收与退出

以主应用构建、真实页面浏览器回归和现有 Ontology 权限/隔离合同为准；结果记录在当前聊天的接入验收报告。隔离的 SYNTHETIC_DEMO 不代表真实企业或线上验收。

出现加载、映射、性能或主框架兼容问题时，先切换原 SVG；保留 API 与回调，回退不需要数据库迁移。需要持久化跨设备布局、编辑连线或处理更大图时再评估新约束。

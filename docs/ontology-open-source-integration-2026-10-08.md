# OpenMetadata 与 OntoGPT 接入

入口：`http://127.0.0.1:3158/data/ontology?businessId=test-a&dataNature=demo&view=integrations`。

NEO 中台增加「开源服务接入」，所有运行记录按企业和数据性质隔离。现有经营输入、规则发布和 `/demo` 数据链路继续使用原有版本约束。

## 已实现的接口

- OpenMetadata 2.0.4：独立本地 MySQL、Elasticsearch 和目录服务，监听 `127.0.0.1:8585`。NEO 通过 REST 创建/更新当前范围专用服务、数据库、schema、对象表结构、业务术语和语义关联；写入后回读表与术语，再保存同步记录。只发送已发布定义，无原始经营行或模型凭证。
- OntoGPT 1.2.0：独立 Python 3.11 环境，实际执行 SPIRES。以当前对象属性生成 LinkML 模板，每次从一段文字抽取一个对象。支持本地 Ollama，以及中台已启用的 OpenAI-compatible 模型。结果记录定义版本、schema hash、模型、调用量、来源 hash、逐字段原文证据、无法匹配字段和缺失必填字段。模型候选可以导出 CSV，在现有接入流程中人工核对并正式校验。
- 管理员写入和同源限制；跨企业、跨数据性质读取被拒绝。模型密钥仅从加密配置解密到服务请求，不进入子进程参数、历史结果、浏览器回读或错误日志。子进程通过 stdin 接收私有配置，最多 180 秒、8 次调用、每次最多 1,500 个输出 token。

目录中的表表示对象定义，并不表示实际对象记录已经落在 OpenMetadata。业务关系保存为 glossary 语义关联，不能据此声称数据加工血缘。同步方向为 NEO 已发布定义 → OpenMetadata；原生平台中修改术语不会自动改写 NEO。

## 本地运行与配置

从仓库根目录执行：

```sh
uv venv --python 3.11 integrations/ontogpt/.venv
uv pip install --python integrations/ontogpt/.venv/bin/python -r integrations/ontogpt/requirements.txt
colima start
docker --context colima compose -f integrations/openmetadata/compose.yml up -d
integrations/ontogpt/.venv/bin/python integrations/openmetadata/bootstrap-local.py outputs/ontology-middle-platform/integrations/config.json
npm run build:local:stable
NEO_LOCAL_OUTPUT=outputs/ontology-middle-platform NEO_WEB_PORT=3158 NEO_AGENT_PORT=8168 NEO_EXECUTION_MODE=live NEO_MANUAL_CHAT=true NEO_MARKET_RESEARCH=false node scripts/start-local-stable.mjs
```

`bootstrap-local.py` 只适用于新建的官方 localhost 开发实例，使用其默认开发登录取得现有 ingestion bot token，不保存管理员登录 session。服务 URL 和令牌存放于 `outputs/ontology-middle-platform/integrations/config.json`，权限 0600、Git 忽略。更换文件后重启该 NEO 预览即可。正式执行服务可配置 `NEO_OPENMETADATA_URL` 和 `NEO_OPENMETADATA_TOKEN`，不应沿用开发实例默认凭证。

Compose 基于官方 2.0.4 quickstart，去掉 Airflow，MySQL 与 Elasticsearch 端口不向主机暴露，仅目录 UI/API 绑定 localhost。官方源保存在 `integrations/openmetadata/upstream-2.0.4.yml`。VM 镜像仓库连通性异常时，可用 `pull-through-host.py` 从官方 Docker Hub 仓库下载、核对 SHA256 内容摘要并导入镜像；不会重启现有 Docker daemon。

本机为 8 GB 内存，OpenMetadata 与本地 LLM 同时运行可能引发换页和延迟。持续多人使用建议将 OpenMetadata 放到独立服务器；当前交付为本地可运行接入，不是生产部署。

## 验收证据

- Node 接入与配置回归：5 项通过，覆盖身份权限、同源限制、范围隔离、失败不记录成功、凭证不入历史与不改写事实。
- Python 接入与模型回归：7 项通过，覆盖允许的模型地址、实际原文匹配、缺失字段、无效输出拒绝和范围命名。
- 局部 ESLint、完整 TypeScript 检查和本地稳定前端构建通过。
- 真实服务与页面验收：OpenMetadata 成功同步并回读 22 类对象、22 个术语和 30 个 NEO 语义关联；额外回读商品的 6 个属性与关联角色术语。OntoGPT 使用本地 Qwen 2.5 3B 抽取商品 PRD-001 和名称，结果刷新后可回读；roleId 漏抽保持空值。记录 ID 分别为 `control-047a2293-6835-475b-825b-fc1e8a8f6d1b` 与 `control-5189033c-3c79-4564-a56c-9208582aa358`。页面控制台无错误。详细证据见 `outputs/ontology-middle-platform/integrations/` 及其验收截图。验收文本为显式演示资料，不代表真实企业抽取质量。

## 当前覆盖边界

OpenMetadata 接入已发布对象目录与术语，不含 Airflow、全量数据库连接器、周期调度、质量规则双向同步或真实加工血缘采集。OntoGPT 首版是单对象文本候选抽取；不包含 PDF/OCR、多对象自动批量入库、企业词表实体消歧或跨对象关系自动落库。小模型可能遗漏或误抽，来源匹配只是可追溯依据，不等于业务事实已验证。此次验收只调用本地免费模型，中台云模型生成路径完成协议与密钥隔离测试，未消耗真实云模型额度。

## 回退

本次修改前备份位于 `/Users/majun/Desktop/NEO/backups/opensource-integration-20261008`。只回退本次目标文件，不覆盖并行开发。停止本预览时按 `runtime.json` 的 PID 发送 SIGTERM。`docker --context colima compose -f integrations/openmetadata/compose.yml down` 停止目录容器，保留数据卷；不要追加 `-v`，以免删除目录数据。

官方依据：[OpenMetadata](https://github.com/open-metadata/OpenMetadata/releases/tag/2.0.4-release)、[OpenMetadata REST schemas](https://github.com/open-metadata/OpenMetadata/tree/2.0.4-release/openmetadata-spec/src/main/resources/json/schema)、[OntoGPT](https://github.com/monarch-initiative/ontogpt)、[自定义 LinkML 模板](https://github.com/monarch-initiative/ontogpt/blob/main/docs/custom.md)。

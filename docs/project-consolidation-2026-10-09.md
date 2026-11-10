# NEO 项目整合记录（2026-10-09）

## 正式版范围

- 唯一正式仓库：`/Users/majun/Desktop/NEO/NEO后端交接包2026-09-30/growthos-dashboard`
- 当时分支/HEAD：`integrate/neo-runtime-delivered-20261008` / `321a739c662484c249dd4afcc115339054fc177d`
- 主产品入口：`/demo`
- 配置与数据治理入口：`/data/ontology`

整合时主仓已有未提交的智能体修复、测试和验收文档。这些文件被作为在制成果保留，未回退、覆盖或当作垃圾清理。

## 已整合

1. 为当时全部 Git branches、tags 和 stash refs 生成 `backups/neo-consolidated-git-20261009/code.bundle`，`git bundle verify` 通过。
2. 注销并移除三个已经完全进入主仓历史的干净 worktree；分支仍保留在主仓与 bundle 内。
3. 移除 `并行优化/`中的七份历史代码副本。审计已确认它们没有主仓之外的唯一实现；两份编号不同的 migration 内容也已存在于主仓。
4. 仅保留一份整合运行态备份和一份当日 Git bundle，其余重复/不完整备份移出工作区。
5. 从正式构建中删除与 `/demo` 平行的 `/neo-v2` 画廊/酒店合成原型、它的专属计算模块/测试/样本，以及未接入的 Sites 模板认证助手、初始 D1 notes 示例和未引用的 starter/OG 静态资源。
6. README 收束为当前唯一入口、代码边界、数据边界和验证命令。

## 整合后验证

- 工作区审计：1 个 Git 仓库、0 份历史代码副本、0 个已知残缺备份；3102/8138 仅指向主仓隔离运行态。
- Git 恢复包：`git bundle verify` 通过，完整历史、19 个 refs；SHA-256 为 `c74ac531ed01c5e2e520ba1d8891ecfbdff13440a0f957618ccb0bcc302541cb`。
- 静态与构建：`git diff --check`、TypeScript 类型检查、生产构建和本地稳定构建通过。
- 删除回归：`tests/workbench-integration.test.mjs` 3/3 通过；新运行实例中 `/demo` 与 `/data/ontology` 返回 200，已删除的 `/neo-v2` 与 `/neo-v2/hotel` 返回 404。
- 当前本地实例：`neo-local-d88762d6035f`，数据仍为隔离的 `SYNTHETIC_DEMO`，未触碰原企业数据库。
- 全量测试不是全绿：Node 406 项中 8 项失败，渲染 20 项中 1 项失败，Python 683 项中 65 项失败、2 项跳过。失败集中在保留的在制智能体、业务契约与已改版 Ontology 文案，不作为本轮删减完成的通过证据。
- 整理后工作区约 7.5 GB；移入废纸篓的内容约 14 GB，清空废纸篓前不会实际释放对应磁盘空间。

## 恢复边界

- 移出的外层副本位于 `/Users/majun/.Trash/NEO-consolidation-20261009`，清空废纸篓前可恢复。
- Git bundle 只恢复已提交历史，不包含未提交修改、未跟踪文件、凭证、虚拟环境或运行数据。
- 保留的整合运行态备份对应 `e13f22532ad3ba19a94b7523f50e8e6dd2e35b4d`，不等于 2026-10-09 当前未提交工作区。

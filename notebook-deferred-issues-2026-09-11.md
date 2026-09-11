# Notebook 文档范围对齐记录（2026-09-11）

## 原始问题

- 原始状态：代码链路已确认；未复现用户实际请求受影响。用户随后批准接通包含、排除两种范围，覆盖问题 2 的文档范围部分和问题 3。
- Notebook 本地版本：`99cfe1d`；Knowhere 本地版本：`bf94dbe5`。
- 实际路径：来源勾选状态 → `excludedSourceIds` → `excludeDocuments` 转为 `excludeDocumentIds` → Knowhere API 的 `exclude_document_ids` → retrieval context。
- Knowhere 已接收参数。进入 agent_explore 时，`run_episode` 和 `ToolContext` 未传递该排除集合；最终 `assemble_retrieval_results` 才过滤结果。
- 示例：排除 A 后，agent 仍可能读 A，最终 A 的证据被删除；是否实际发生、是否影响答案尚未验证。
- 批准方案：将请求级包含、排除集合传到 Explore 工具上下文，各工具数据库查询在返回给模型前执行过滤，保留最终过滤；小语料和朴素检索执行同样范围。不增加模型调用，agent 在允许范围内继续自由探索。
- 验证：排除 A 时，list/recall/grep/node_filter/read/assets/neighbors 均不能返回 A；未排除 B 仍能正常探索。空排除集合保持原行为。
- 本次实现覆盖显式文档包含和排除；自然语言筛选仍由 agent 选择 node_filter 等工具执行。

代码位置：

- Notebook：`src/components/workspace-chat-workflow.ts`、`src/domains/chat/retrieval.ts`、`src/domains/chat/index.ts`。
- Knowhere：`apps/api/app/api/v1/routes/retrieval.py`、`packages/shared-python/shared/services/retrieval/execution/routes.py`、`packages/shared-python/shared/services/retrieval/agent_explore/dispatch.py`、`packages/shared-python/shared/services/retrieval/agent_tools/registry.py`。

## 参数约定与实现

- `includeDocumentIds` / `include_document_ids`：不传表示不限制，`[]` 表示空范围；只检索列表中的文档。
- `excludeDocumentIds` / `exclude_document_ids`：排除列表中的文档；排除优先。
- Notebook：现有 `knowhere_search` 工具增加两个字段；与资料排除状态合并。仅接受已有资料或本轮先前检索结果中确认的文档 ID，未知名称仍随自然语言 query 交给 Knowhere 定位。
- SDK：新增包含参数类型与文档，HTTP 序列化保留空数组。Notebook 当前安装的 SDK 已用真实本机 HTTP 请求验证能正确发送，无需写入本地依赖路径。
- Knowhere：统一 `DocumentScope` 作用于三种检索路径、八个 corpus 工具、最终引用和关联资源；缓存区分未限制、空集合、指定集合。
- 清理仅限本次范围：Notebook 合并重复搜索请求类型；Knowhere 移除 recall 为限定文档而先查全库补集的旧转换。
- 不涉及 DeepSeek 收工门禁、模型配置、路径/阈值语义或前端展示机制。

## 验证记录

- Notebook：聊天、账本、引用和媒体相关 193 项测试通过；TypeScript、ESLint、diff 检查通过。
- SDK：61 项测试通过，包含两种认证方式下的实际 HTTP 字段检查；类型、lint 和格式检查通过。
- Knowhere：42 项真实 PostgreSQL 合约测试、27 项共享测试通过；最后兼容性调整后，15 项范围合约测试再次通过。Pyright、Ruff、diff 检查通过。
- 两种 Explore harness 使用真实执行循环和数据库工具，模型 provider 使用模拟回复；未调用线上模型，未验证其自然语言选择行为。数据库测试使用隔离测试库。
- 尚未提交、发布或部署；线上需后端发布后才会执行新增范围语义。
- Effect 指南：已查阅 `basics`、`testing`；保留现有 Effect 执行方式。

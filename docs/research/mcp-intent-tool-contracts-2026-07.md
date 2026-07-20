# Director X MCP 意图工具与契约收敛研究

> 日期：2026-07-21  
> 研究范围：Director X Codex 插件的 MCP 工具表面、结果契约、工具影响标注、Canvas 应用工具可见性，以及 `search` / `fetch` 兼容。  
> 代码基线：`99b7cd2fe9e36d8c337d97f12ad4717aef38d4b3`。研究期间目标分支存在并行实现，因此本文区分“基线问题”“目标设计”和“迁移期兼容层”。

## 结论

Director X 不应把当前约 167 个生产原语直接交给模型选择，也不应通过增加 10–20 个别名、但继续列出全部低层工具的方式声称完成了收敛。正确目标是：

1. 默认 `tools/list` 只向模型返回 16 个 Director X 用户意图工具。
2. 面向 Company Knowledge、Deep Research 或数据型连接器的部署配置，可额外返回严格兼容的标准 `search` 和 `fetch`，总数为 18。
3. Canvas 组件直接调用的少量工具标记为 `_meta.ui.visibility: ["app"]`；它们不参与模型选工具，但仍必须在服务端验证身份、会话和权限。
4. 其余低层生产工具降为 server-private service，不出现在 MCP registry，也不能被任意 `tools/call` 绕过 Facade 调用。
5. Facade 不是低层工具的同 schema alias。它必须拥有独立、窄而明确的 `inputSchema`、精确的 `outputSchema`、可靠的幂等边界，以及把多个低层步骤压进同一持久化 Run 事务的编排逻辑。
6. 所有公开工具返回小型 `structuredContent`；完整 Run、Canvas 图、帧清单、供应商原始结果和诊断信息留在持久化工件或组件 `_meta`，不再把整份 Run 快照塞给模型。

这既保留现有低层运行时的专业能力，也能显著降低模型的工具歧义、错误顺序、重复调用和上下文膨胀。

## 一手来源与证据边界

本研究只使用以下一手来源：

- OpenAI Apps SDK 的 [Build your MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)：明确要求“一项用户意图对应一个工具”，建议为结构化结果声明 `outputSchema`，说明三种结果通道、工具可见性和影响标注。
- OpenAI Apps SDK [Reference](https://developers.openai.com/apps-sdk/reference)：定义 `_meta.ui.visibility`、`structuredContent` / `content` / `_meta` 的 ChatGPT 传递边界，以及 descriptor 和 result `_meta` 的不同放置位置。
- OpenAI Platform 的 [Building MCP servers](https://platform.openai.com/docs/mcp)：给出 Company Knowledge、Deep Research 所需的 `search` / `fetch` 精确输入和推荐输出形状。
- MCP 官方 [Tools specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) 与 [Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)：定义 `Tool`、`CallToolResult`、`ToolAnnotations`，并明确 annotations 只是 hints。
- [`openai/openai-apps-sdk-examples`](https://github.com/openai/openai-apps-sdk-examples/tree/18cc38e78a968712c357bacdc3c79fead5bfc6b4)：验证官方示例如何同时返回 `content`、`structuredContent` 和 `_meta`，以及如何声明影响标注。示例代码注释可能落后于当前文档；字段可见性以当前 Apps SDK 文档为准。
- [`openai/plugins`](https://github.com/openai/plugins/tree/11c74d6ba24d3a6d48f54a194cd00ef3beea18f9)：官方仓库把插件组织为 Manifest、Apps/MCP 连接和少量面向任务的 Skills。例如 [Notion plugin](https://github.com/openai/plugins/tree/11c74d6ba24d3a6d48f54a194cd00ef3beea18f9/plugins/notion) 将一个 MCP 连接与研究、会议、知识沉淀、实施规划等任务 Skill 组合。由此可合理推断：插件产品层应负责意图和工作流，MCP 原始工具数量不应直接决定模型体验。

## 当前仓库审计

### 工具表面

基线 `mcp/server.mjs` 定义 167 个 `directorx_*` 工具，其中大约 29 个使用 `readOnlyAnnotations()`，其余大部分使用统一的 `writeAnnotations()`。工具包括：

- Goal、Intake、原生问题、Run、恢复和 Stage 控制；
- 子智能体、执行图、能力与工具路由；
- 研究、参考片、资产、证据索引和版权；
- 导演文档、镜头、摄影、转场、连续性和视觉提示；
- Provider、定价、预算、凭证、生成任务和候选；
- 字幕、波形、时间线、OpenCut、Remotion、HyperFrames；
- 全帧审片、修复、Benchmark、OTLP 和基线治理；
- Canvas 的对象、打开、快照和本地会话能力。

这些原语适合作为内部生产运行时 API，但不适合同时成为模型的顶层选择集合。大量工具名称只在“记录、注册、编译、绑定、更新、确认”上有细微差异，模型必须理解内部状态机才能正确选择。

### 契约问题

`mcp/tool-registry.mjs` 的基线只保证工具具有 `inputSchema`，没有强制每个返回 `structuredContent` 的工具声明精确 `outputSchema`。`mcp/server.mjs` 的 MCP wrapper 把 handler 返回的整个对象直接放进 `structuredContent`，而 `content` 仅通过 `conciseToolResult()` 生成一句通用文本。

这产生四个直接问题：

1. 客户端不能提前验证或可靠组合结果。
2. 模型看到完整 Run 或大型领域对象，增加上下文成本。
3. 低层 handler 的内部字段变化会意外成为公开 API 破坏性变更。
4. 恢复、下一步和用户可见摘要没有稳定的 discriminated contract。

给所有工具统一补 `{ "type": "object", "additionalProperties": true }` 只能作为迁移期兼容占位，不能满足 OpenAI 文档所说的“描述工具实际返回的 exact object”。

### Annotation 问题

当前两个 helper 把所有读取统一标成 closed-world、把所有写入统一标成 non-destructive、non-idempotent、closed-world。这不符合实际影响：远程搜索、Provider 提交、参考视频下载等显然触达 open world；稳定 key 的 upsert 或 Provider submit 可以是幂等写；取消任务、撤销基线和可能覆盖用户编辑的操作需要逐项判断 destructive。

### 对话层问题

`mcp/conversation-ux.mjs` 为一小部分低层工具提供精确标题，其余依赖正则归类。公开工具收敛后，conversation UX 应只为 16 个意图工具维护明确标题、运行中状态、完成状态和用户摘要；低层工具只在 Canvas Activity 诊断面显示，不需要参与主对话措辞。

## 协议字段的正确边界

### `inputSchema`

`inputSchema` 是模型或应用调用工具时必须满足的 JSON Schema。根节点必须是 object。对公开 Facade：

- 只收用户意图所需字段，不暴露内部 artifact 文件名、状态迁移枚举或 subagent registry 细节。
- 正确性所需字段必须显式，不依赖模型记忆。
- 相关的多动作必须使用有判别字段的 `oneOf`，不能使用一个任意 `action: string` 加任意 payload。
- 默认 `additionalProperties: false`，避免模型把对话或敏感上下文随意塞进参数。

### `outputSchema`

MCP 的 `outputSchema` 描述 `CallToolResult.structuredContent`。当工具返回 `structuredContent` 时，OpenAI 文档要求声明它，并让两者匹配。Director X 公开工具应：

- 每个工具都有明确 root object；
- `required`、枚举、数组上限、嵌套对象和 nullable 形状明确；
- `additionalProperties: false`；
- 不使用“空 properties + arbitrary additionalProperties”作为完成态；
- 对 error 也使用稳定结构，或返回 `isError: true` 加一个严格的 `error` schema。

同一 schema family 可以复用，但每个工具仍应收窄 `intent`、`stage`、`nextActions[].type` 等枚举，让它成为该工具的 exact result，而不是一个万能 Run envelope。

### `structuredContent`

在 ChatGPT Apps 中，`structuredContent` 同时供模型和组件读取，也进入会话记录。它应该只包含模型决定下一步所需的最小数据：

- Run ID、revision、stage 和状态；
- 简洁里程碑与可见成果计数；
- 新增或改变的少量 artifact references；
- 唯一、公开的下一步动作；
- 阻塞时的最小恢复信息。

不要放完整 Canvas graph、完整 Run、所有帧、完整供应商回执、凭证、原始日志或大段研究正文。

### `content`

`content` 是模型和组件可见的非结构化内容，也会出现在会话记录。Director X 应继续用它承载一句自然语言进度，但文字必须与 `structuredContent.summary` 一致。`content` 不是结构化结果的替代品。

### `_meta`

必须区分 descriptor `_meta` 与 result `_meta`：

- Tool descriptor `_meta`：放 UI resource URI、visibility、调用中/完成状态等客户端扩展。
- Tool result `_meta`：在 ChatGPT Apps 中只交给组件，模型不可见，适合 Canvas hydration、完整图增量、显示布局和组件会话标识。

即便 result `_meta` 对模型隐藏，也不能当作秘密保险箱。OpenAI 的安全提醒明确要求不要在 `structuredContent`、`content`、`_meta` 或 widget state 中放 API key、token 或 secret。凭证只能留在当前 MCP 进程或受保护的 credential provider 中。

## ToolAnnotations 与真实幂等性

MCP 官方规范把所有 annotations 定义为 hints；客户端不能把来自不可信 server 的 hints 当作授权依据。OpenAI Apps 客户端会用这些 hints 调整确认和影响说明，但 Director X 服务端仍必须执行自身权限、预算、版权、审批和 Run gate。

| Hint | 协议默认 | Director X 判定规则 | 典型例子 |
| --- | --- | --- | --- |
| `readOnlyHint` | `false` | 不创建、更新、删除、发送数据，也不写 Run/文件时才为 `true` | `get_production_status` 为 true；读取视频并写 evidence artifacts 为 false |
| `destructiveHint` | `true` | 仅对 write 有意义；删除、覆盖或不可逆外部副作用为 true | 取消已提交 Provider job、撤销已发布基线；非破坏性 revision append 为 false |
| `idempotentHint` | `false` | 相同参数重复调用不会产生额外事件、成本、工件、Provider job 或状态变化 | 带稳定 idempotency key 的 generate submit、按 stable ID 的 upsert |
| `openWorldHint` | `true` | 触达任意 URL、外部 Provider、网络搜索、任意外部资源时为 true；限定当前 Run 的本地状态为 false | 远程资产搜索/生成为 true；更新当前 Run checkpoint 为 false |

实现上必须把“声明幂等”与“真正幂等”绑定：

- Facade 接收或生成稳定 `operationId`；
- Run 保存 `operationId -> result revision`；
- 重试返回同一结果，不重复扣费、不重复追加事件；
- 外部 Provider 使用其 idempotency key；
- 没有上述保证的 write 不得标 `idempotentHint: true`。

## 目标工具表面：16 + 2

### 16 个默认模型可见工具

| # | 公开工具 | 用户意图 | 内部能力编排 | Input 是否需要 action union |
| --- | --- | --- | --- | --- |
| 1 | `directorx_start_production` | 启动一项视频制作 | preflight、Canvas、Goal entry、create Run、满足条件时 fast start | 否；只接受 outcome、project、host capabilities |
| 2 | `directorx_resume_production` | 从持久化 Run 继续 | snapshot、surface rebind、resume plan | 否 |
| 3 | `directorx_get_production_status` | 查看当前真实进度 | Run projection、visible artifacts、pending decision | 否；严格 read-only |
| 4 | `directorx_decide_production` | 发起或落盘一次原生决策 | create-and-ask、resolve interaction、gate clearing | 是：`prepare` / `resolve`，以 `action.type` 判别；resolve 必须带 opaque continuation token 和原始 answers envelope |
| 5 | `directorx_research_video` | 分析参考片、品牌和素材 | reference ingest、video evidence、web research、asset acquisition、rights/quality audit、research package | 是：`reference` / `brand` / `asset` / `all`；这是同一研究意图的范围选择 |
| 6 | `directorx_design_video` | 生成脚本、分镜和镜头设计 | Director document、claim-proof、shot grounding、scene coverage、transition、visual prompt pack | 是：`script` / `storyboard` / `production_design` / `all` |
| 7 | `directorx_dispatch_production_team` | 安排并行 DX 专家执行 | complexity、team plan、parallel subagents、execution graph、dispatch evidence | 否；由 Run 推导缺失任务，避免让模型手工传完整图 |
| 8 | `directorx_generate_media` | 生成正式图片、视频、配音或音乐 | route、pricing/budget、generation plan、submit/poll、candidate registration | 是：`image` / `video` / `voice` / `music`，每个 branch 有自己的严格字段；必须有 `operationId` |
| 9 | `directorx_review_media_candidate` | 审查并选择/拒绝一个生成候选 | quality review、continuity、edit fit、select candidate | 是：`review` / `select` / `reject`；不得把 repair 混入 |
| 10 | `directorx_build_rough_cut` | 用已有证据形成可播放粗剪 | evidence rough cut、edit graph、timeline revision、caption/audio bindings | 否 |
| 11 | `directorx_edit_video` | 预览或应用剪辑修改 | edit intent、timeline patch、preview、commit、OpenCut session/import | 是：`preview_patch` / `commit_patch` / `open_editor` / `import_editor_result` |
| 12 | `directorx_render_video` | 渲染当前获批时间线 | quality contract、render projection、Remotion/HyperFrames/OpenCut renderer | 是：`preview` / `final`；renderer 应由 approved route 推导，不让模型任意切换 |
| 13 | `directorx_audit_final_video` | 对成片做穷尽审片 | final media probe、full-frame audit、scene coverage、AV evidence、final review | 否 |
| 14 | `directorx_repair_video` | 根据缺陷证据修复成片 | repair branch、identity evidence、targeted regenerate/edit、complete branch | 是：`plan` / `execute` / `complete`，每一步绑定 repairBranchId |
| 15 | `directorx_finalize_production` | 完成交付并允许 Goal 完成 | completion policy、delivery approval、publish package、Goal completion action | 否 |
| 16 | `directorx_recover_production` | 从失败点恢复 | minimal recovery action、corrected arguments、recover/resume | 是：`inspect` / `apply`；apply 只接受 server 返回的 recovery token，不接受任意内部工具名 |

这 16 个工具是产品 API，不应是一对一 alias。比如 `directorx_generate_media` 需要在一个 facade 内完成预算 gate、route 验证、幂等提交和 Run 记录，而不是仅改名后直接调用 `directorx_submit_media_generation`。

### 可选 `search` / `fetch`

仅在远程 Company Knowledge / Deep Research 配置启用：

```json
{
  "name": "search",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": { "query": { "type": "string" } },
    "required": ["query"]
  },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

`fetch` 的唯一必需参数为 `id: string`。推荐输出：

- `search`: `{ results: [{ id, title, url }] }`
- `fetch`: `{ id, title, text, url, metadata? }`

两者都必须把同一 JSON 同时放入 `structuredContent` 和 `content[0].text` 的 JSON 字符串，以保证兼容。只有非空、用户可打开的绝对 HTTP(S) `url` 才能形成引用；内部 ID 放 `id`，没有公开 URL 时留空，不要伪造 URL。

Director X 的搜索索引应只覆盖可读的持久化产物与证据摘要，不应让 `fetch` 读取凭证、隐藏 prompt、完整私有日志或未授权源文件。

## 严格输出契约

### 公共基础字段

所有 16 个 Facade 共享以下命名，但各工具应复制并收窄枚举，而不是用一个 `additionalProperties: true` 万能 schema：

```json
{
  "contractVersion": "1.0",
  "intent": "research_video",
  "status": "completed | in_progress | requires_action | blocked | failed",
  "run": {
    "runId": "dx-...",
    "revision": 42,
    "stage": "research",
    "status": "production_in_progress"
  },
  "summary": {
    "headline": "参考片分析已完成，已形成节奏与镜头证据。",
    "changed": ["reference_analysis", "media_evidence_index"],
    "visibleResults": { "documents": 2, "images": 12, "videos": 1, "audio": 0 }
  },
  "artifacts": [
    { "artifactRef": "...", "kind": "document", "label": "参考片分析", "stage": "research" }
  ],
  "nextActions": []
}
```

Director X 产品级限制建议：`artifacts` 只返回本次新增或改变的前 20 个引用，`changed` 最多 20 项，`nextActions` 最多 3 项。完整列表从 Canvas 或 `fetch` 获取。这是 Director X 的上下文预算策略，不是 MCP 标准限制。

### Action union

需要 action union 的 Facade 必须使用 discriminated `oneOf`：

```json
{
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "type": { "const": "host.request_user_input" },
        "requestId": { "type": "string" },
        "continuationToken": { "type": "string" },
        "questions": { "type": "array", "minItems": 1, "maxItems": 3 }
      },
      "required": ["type", "requestId", "continuationToken", "questions"]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "type": { "const": "directorx.call_public_tool" },
        "tool": { "enum": ["directorx_research_video", "directorx_design_video"] },
        "arguments": { "type": "object" }
      },
      "required": ["type", "tool", "arguments"]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": { "type": { "const": "none" } },
      "required": ["type"]
    }
  ]
}
```

关键规则：

- `nextActions` 只能指向 Codex host action 或 16 个公开工具，不能泄漏 server-private 工具名。
- 原生问题的 `continuationToken` 是不透明、短期、绑定 request/run/revision 的 token；客户端不手工拼 `resolve_user_interaction` 参数。
- 同一结果只能给出一个 blocking next action，避免恢复接口再次返回完整 Run 和多条互相竞争的路线。

### 六个 schema family

| Family | 工具 | 必需的专有字段 |
| --- | --- | --- |
| Lifecycle | start、resume、status、finalize、recover | surface/goal 状态、唯一 next action；recover 额外含 minimal recovery |
| Decision | decide | interaction request、问题或 resolved decision，不同时返回两者 |
| Creative work | research、design、dispatch、rough cut、edit、render、repair | 本次阶段产物、阶段门状态、明确 work scope |
| Generation | generate | requestId、operationId、provider route 摘要、cost commitment、job/candidate 状态 |
| Candidate review | review candidate | candidateId、rubric decisions、selected/rejected 状态、evidence refs |
| Final audit | audit | expected/audited frame coverage、AV checks、defects、pass/fail disposition |

每个 family 应有共享 builder，但最终生成每个工具自己的 schema 常量并在 CI 中 snapshot，防止无意变成宽泛 schema。

## 私有工具分组

现有低层工具不删除，按以下模块降为内部 service。表中是代表性工具，不是新的公开 MCP 名单。

| 内部分组 | 现有代表能力 | 由哪些 Facade 使用 |
| --- | --- | --- |
| `lifecycle` | preflight、create run、bind goal、fast start、checkpoint、transition stage、completion | start、resume、finalize、recover |
| `interaction` | request/create/resolve native interaction、approve stage、record decision | decide、finalize |
| `orchestration` | complexity、team/parallel plan、subagent registry、execution graph、tool/capability route | dispatch |
| `research_evidence` | reference ingest/assessment/replication、web research、media evidence/query/trace/bundle | research |
| `assets_rights` | asset search/acquire/register/quality/coverage、music audit、download consent | research、generate |
| `direction` | Director document、claim-proof、shot grounding、scene/camera/transition、visual prompt | design |
| `providers_budget` | capability probe、media provider/custom adapter、pricing/quote、credential、task transport | generate、render |
| `generation_jobs` | generation plan/attempt、provider submit/poll/update/cancel、candidate record | generate |
| `candidate_quality` | generation candidate review/select、continuity and quality reports | review candidate |
| `timeline_editing` | rough cut、edit graph/intent/patch/preview/commit、waveform/caption/AV timeline、OpenCut | rough cut、edit |
| `rendering` | render quality contract/projection、Remotion、HyperFrames、OpenCut render | render |
| `final_review_repair` | exhaustive media verify、frame identity、scene conformance、final review、repair branch | audit、repair、finalize |
| `governance` | benchmark、verifiers、schedule、baseline、OTLP、knowledge patch/lineage | app-only Admin/Activity，默认无模型入口 |
| `canvas_runtime` | canvas objects/snapshot/open、runtime install/status、session credential | app-only 或 Facade 内部；credential 永不模型可见 |

## Facade 如何安全调用 server-private 工具

推荐把当前单一 `executeTool(name, args)` 演进为三层：

```text
MCP public registry (16/18 descriptors)
        ↓ validate public input
Intent facade handlers
        ↓ direct in-process service calls + one Run transaction
Private production services
        ↓ providers / filesystem / durable Run / artifacts
```

### 不要递归调用自己的 MCP

Facade 不应通过 `tools/call` 调用同一 server 的低层工具，也不应启动辅助 MCP Runtime。它应该直接调用从低层 handler 提取出的 service function。这样可以：

- 保持一个 Run、一个 Runtime、一个 Canvas truth source；
- 在 Facade 边界统一事务、幂等、权限和结果投影；
- 避免内部工具被 host 重试、审批或对话曝光；
- 让低层单元测试继续直接测 service。

### 三种可见性不是同一件事

1. **Model-visible public**：出现在默认 `tools/list`，`_meta.ui.visibility` 为 `["model", "app"]` 或省略。
2. **App-only**：出现在 Apps-compatible list，descriptor 使用 `_meta.ui.visibility: ["app"]`；例如 Canvas selection、局部 waveform window、credential injection。Visibility 不是授权，handler 仍验证 widget session/claim、Run 和权限。
3. **Server-private**：不注册为 MCP tool，也不接受外部 `tools/call`；只能由 Facade 直接调用 service。

绝大多数现有 167 个工具应属于第 3 类，而不是第 2 类。把所有低层工具设为 app-only 仍会扩大 descriptor、留下绕过 Facade 的调用入口，并混淆 Canvas 与生产服务边界。

### Registry 规则

默认启动配置固定选择 profile，避免在会话中动态改变工具列表：

- `public`：16 个 Facade；Codex 插件默认。
- `knowledge`：16 个 Facade + `search` / `fetch`；远程知识配置。
- `expert-compat`：迁移期测试和旧自动化使用，额外列出 legacy tools；不得作为默认 marketplace 配置。
- `app` 不是独立信任 profile；app-only 调用由 host visibility 加服务端 widget session 验证共同决定。

`tools/list` 必须按 profile 返回不同 descriptor 集合。仅在 registry 中增加 `toolTier` metadata、但仍 `list()` 全部工具，不算收敛。`tools/call` 也必须检查 profile/audience：未列出的 server-private 名称应返回 method/tool unavailable，而不是“虽然没列出但知道名字仍可调用”。

迁移期旧调用兼容可通过明确的 server launch 配置启用，不能根据 `_meta["openai/userAgent"]` 或 locale 推断身份；OpenAI 文档明确说明这些字段只能作提示，不能用于授权。

## 迁移顺序

### Phase 0：锁定基线

- 导出 167 个工具的 descriptor、调用者、读写影响、网络影响、幂等键和 handler 测试覆盖。
- 建立 golden Run fixtures，记录典型短宣传片从 start 到 final 的状态和工件哈希。
- 为每个低层工具标记 `public candidate`、`app-only`、`server-private`、`legacy-only`。

### Phase 1：契约基础设施，不改可见面

- Registry 强制所有结构化结果有 `outputSchema`。
- 先为 16 个 Facade 写严格 schema；legacy 工具允许带明确 `legacyLooseContract: true` 的临时宽 schema，CI 报数且只能下降。
- 增加 `projectPublicResult()`，把 domain result 投影为结构化小结果，停止直接暴露完整 handler return。
- 增加 input/output runtime validation 与 secret scanner。

### Phase 2：真正实现 Facade

- 从 `executeTool` 分离 private service map。
- Facade 直接调用 service，不做 alias。
- start、decision、generation、render、recover 优先，因为这些阶段最容易出现顺序错误、重复扣费和巨大恢复响应。
- 为每个 Facade 增加 operation ledger 和稳定 revision。

### Phase 3：默认公开列表收敛

- `public` profile 的 `tools/list` snapshot 必须严格等于 16 个名字。
- Canvas app-only 工具使用 `_meta.ui.visibility: ["app"]`，同时加 session/claim authorization。
- server-private 名称从 MCP registry 移除；内部 tests 改为直接调用 service。

### Phase 4：`search` / `fetch` 和远程部署

- 建立只读、授权过滤的 Director X artifact/evidence 索引。
- 精确实现兼容 schema、structured result 和 JSON text content。
- 验证可引用 URL、无 URL fallback、private artifact exclusion。

### Phase 5：兼容退场

- `expert-compat` 至少保留两个 minor release，并在调用结果返回 machine-readable deprecation metadata。
- 统计旧工具调用；达到零后移除 external legacy registry，但保留 private services。
- 公共 semver 只承诺 16/18 个工具和其 schema；低层 service 属于内部 API。

## 兼容策略

### 旧 Skill 和系统提示词

- 先把 Skills 中的低层工具序列改为调用 Facade。
- 同一版本继续识别 legacy tool names，但仅在 `expert-compat` profile。
- SERVER_INSTRUCTIONS 只描述 16 个工具间的高层顺序，不重复 167 个原语。

### Canvas

- Canvas 继续读取 durable Run，不依赖 Facade response 保存独立状态。
- Facade result `_meta` 只携带 Canvas patch 或 hydration key；刷新后仍从 Run 重建。
- Canvas 对内部操作发出业务 intent，而不是直接修改 Run 的任意节点。例如“提交时间线修改”调用 `directorx_edit_video` 的 `commit_patch` branch。

### 错误与恢复

公开 error contract：

```json
{
  "error": {
    "code": "DX_BUDGET_GATE",
    "message": "生成请求超过当前镜头预算。",
    "retryable": false,
    "completedWorkPreserved": true,
    "recoveryToken": "opaque-token",
    "nextAction": {
      "type": "directorx.call_public_tool",
      "tool": "directorx_decide_production"
    }
  }
}
```

不要返回整份 Run，也不要让 error 指示模型直接调用低层 `record_*`、`register_*` 或 `transition_*`。

## 验证矩阵

| 范围 | 必须证明的行为 | 自动化证据 |
| --- | --- | --- |
| Descriptor 完整性 | 16/18 个公开工具均有 name、title、description、严格 input/output schema、完整三项 impact hints | descriptor snapshot + JSON Schema meta-validation |
| 默认可见面 | `public tools/list` 只含 16 个工具，无 legacy names | exact set assertion |
| Knowledge 可见面 | 只额外增加 `search`、`fetch` | exact set assertion |
| App-only | 模型列表不出现 credential/Canvas micro-action；组件可调用且无 session/claim 时拒绝 | model/app audience integration tests |
| Server-private | 手工 `tools/call` 低层名称失败；Facade 内部 service 调用成功 | transport test + service unit test |
| Input union | 每个 action branch 接受合法形状，拒绝混合 branch 和多余字段 | per-branch positive/negative schema tests |
| Output exactness | handler 每种 status/error branch 都满足该工具 outputSchema | runtime validator + fixture matrix |
| 结果体积 | structured result 只含 delta 和少量 refs，不含完整 Run/Canvas/raw provider payload | response budget assertions + forbidden-key scan |
| Annotation 准确性 | remote provider/search 是 open-world；真正 read-only 不写盘；destructive 流程触发确认 | mocked effect tests + approval snapshots |
| 幂等性 | 相同 operationId 重试不重复 job、成本、event 或 artifact | double-call state/hash comparison |
| Facade 等价性 | Facade 完成后的 durable Run 与已验证低层 golden flow 等价 | golden Run semantic diff |
| 原子决策 | prepare 后只能用绑定 token resolve；重复 resolve 返回同 revision | interaction concurrency tests |
| 单 Runtime | Facade 不创建辅助 MCP；Run、Canvas、service 使用同一 runtime/session | process-spawn spy + canvas projection test |
| 恢复最小化 | blocked 只给根因、是否可重试、修正示例/opaque token 和唯一公开下一步 | recovery schema snapshot |
| Search | input 只有 query；结果同时出现在 structuredContent 和 JSON text | Company Knowledge compatibility fixture |
| Fetch | input 只有 id；URL 合法时可引用，无 URL 时保持普通输出 | URL and no-URL fixtures |
| Secret 安全 | input、structuredContent、content、result `_meta`、widget state 均不回显 key/token | seeded-secret end-to-end scan |
| Conversation UX | 只展示公开意图标题和真实里程碑；内部工具留在 Activity | conversation snapshots |
| 兼容 profile | 旧 Skill 仅在显式 expert-compat 下工作并返回 deprecation | profile integration tests |

## 实施验收门槛

本 Feature 不能以“新增了 16 个 alias”验收。完成必须同时满足：

1. 默认模型工具列表确实收敛到 16。
2. 16 个 Facade 不是简单 alias，而是独立 intent contract 和编排边界。
3. 每个 Facade 的所有成功、阻塞、需要交互、失败分支都有严格 output schema。
4. 低层工具无法从默认 MCP transport 被直接调用。
5. Facade 重试不会重复扣费、重复 Provider job 或重复事件。
6. Canvas app-only 调用有服务端授权，visibility 不被当作安全边界。
7. golden production flow、恢复、原生问题、生成、渲染、全帧审片和 Goal completion 全部回归通过。
8. 如启用 knowledge profile，`search` / `fetch` 通过精确兼容测试。

## 推荐的首个实现切片

先完成以下 5 个工具的严格纵切，而不是一次给全部 legacy tools 加宽 schema：

1. `directorx_start_production`
2. `directorx_decide_production`
3. `directorx_resume_production`
4. `directorx_get_production_status`
5. `directorx_recover_production`

这组覆盖 Goal、Canvas、原生交互、Run resume、阻塞恢复和 tool visibility，是整个契约层的最小闭环。验证通过后，再依次加入 research/design、generation、edit/render、audit/repair/finalize。


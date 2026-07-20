# Director X Codex 插件下一能力缺口研究

日期：2026-07-21  
本地基线：`feature/video-reading-toolkit` @ `9d2a9e644156011e143c12483c1772de42b53b60`  
结论置信度：高（本地源码审计 + 一手规范/官方示例；未使用二手文章）

## 结论

首选独立 feature：

```text
feature/standard-mcp-app-canvas
```

目标是把当前仅“长得像 MCP App”的 inline Canvas，升级为真正遵循稳定 MCP Apps 规范的生产伴随界面：协商 `io.modelcontextprotocol/ui`，使用标准 App 生命周期和 `PostMessageTransport`，通过应用专用工具及受控 MCP Resources 读取 Run/媒体证据，同时保留现有 Codex side Browser 作为完整制作工作台。

这比继续增加视频业务工具更优先，因为插件已经具备完整生产纵深，但 inline UI 仍依赖 `window.openai` 和 OpenAI 兼容字段；其跨宿主生命周期、能力检测、取消、主题/尺寸/显示模式、资源读取和安全边界没有形成标准契约。

## 审计范围

- `README.md`、`package.json`
- `.codex-plugin/plugin.json`、`.mcp.json`
- `app/canvas.html`、`app/browser-canvas.html`、`app/opencut-editor.*`
- `mcp/server.mjs` 及任务、工具契约、Canvas、媒体相关模块
- `skills/`（34 个 `SKILL.md`）

## 当前已具备能力

| 能力域 | 当前证据 | 判断 |
| --- | --- | --- |
| 插件产品包装 | Manifest、3 个默认入口、图标、MCP Server、34 个视频技能 | 已具备 |
| 持久生产控制 | Goal、Run、8 阶段、审批、检查点、恢复、完成门 | 已具备 |
| 专业生产原语 | 约 170 个 MCP 工具，覆盖研究、脚本、镜头、生成、编辑、审片、交付 | 已具备且偏宽 |
| 多智能体 | DX 角色、执行图、依赖、并发波次、任务状态 | 已具备 |
| Provider 与成本 | 可替换 Provider、定价证据、预算、作业提交/轮询/取消、凭据隔离 | 已具备 |
| 视频理解与连续性 | 自适应视频读取、全帧证据、首尾帧、段落连续性、长视频记忆 | 已具备 |
| 编辑与渲染 | Remotion、HyperFrames、FFmpeg、OpenCut、字幕、波形、音频分析 | 已具备 |
| 质量与可观测性 | 全帧审计、修复分支、Benchmark、OTLP 兼容导出 | 已具备 |
| 完整工作台 | side Browser Canvas、A/B 审片、时间线、媒体图、断点恢复 | 已具备，Codex 专用 |
| Inline UI 服务端元数据 | `ui://`、`text/html;profile=mcp-app`、`_meta.ui.resourceUri/visibility` | 部分具备 |
| Inline UI 客户端协议 | 仍直接读取 `window.openai.toolOutput` 并调用 `window.openai.callTool` | 明确缺口 |
| MCP Resources | 仅列出一个 Canvas HTML Resource；无 Run/工件/媒体 Resource Template | 明确缺口 |
| MCP Tasks | 有 `task_transport.json` 协商骨架，但 `serverTaskMethodsReady=false`，无任务方法 | 有意识地未实现 |
| 协议能力 | `initialize` 仅声明 tools/resources；无 MCP Apps extension 协商 | 明确缺口 |

## 排序缺口矩阵

评分：价值与确定性 1–5；成本与风险 1–5（越高越难/越险）。

| 排名 | 缺口 | 价值 | 确定性 | 成本 | 风险 | 决策 | 理由 |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 标准 MCP App Production Canvas | 5 | 5 | 3 | 2 | **Adopt** | 稳定规范已发布；当前实现已完成约一半服务端形状，迁移边界清晰 |
| 2 | Run/工件/小型媒体 Resource Templates | 4 | 5 | 3 | 3 | **Adopt，纳入 #1** | 官方视频示例证明 App 可经 `resources/read` 获取二进制；需严格大小与权限边界 |
| 3 | MCP Apps 能力/版本协商与兼容测试矩阵 | 4 | 5 | 2 | 2 | **Adopt，纳入 #1** | 服务器当前固定返回协议版本，未按 host capability 决定 UI 元数据 |
| 4 | 标准 progress 与 cancellation 映射 | 4 | 4 | 3 | 3 | **Adopt after #1** | 渲染/转写/全帧审计适合进度通知；先稳定传输层再接生产作业 |
| 5 | 已批准剪辑 → 可复用 Style Skill 编译器 | 4 | 4 | 3 | 3 | **Adopt after #1** | 当前有 Style Playbook/时间线契约，但没有把已批准工作流参数化、带证据地归档为 Skill |
| 6 | 原生 MCP Tasks 作业桥 | 5 | 2 | 4 | 4 | **Defer** | 2025-11-25 Tasks 仍标 experimental；仓库已正确 fail-closed，且 2026 draft 正迁移 wire 模型 |
| 7 | MCP Elicitation / MRTR 取代 Codex 原生问题桥 | 3 | 2 | 4 | 5 | **Defer** | 当前 `request_user_input` 已提供稳定审计门；MRTR 正在改变 server-initiated request 模型 |
| 8 | 远程 MCP + OAuth | 3 | 4 | 5 | 5 | **Defer** | 当前产品是本地 stdio、会话凭据和本机媒体；远程化会扩大身份、租户和媒体数据风险 |
| 9 | MCP Prompts/Completion Server | 2 | 5 | 2 | 2 | **Reject now** | 34 个 Skills + Manifest 默认入口已承担意图层；新增 Prompts 会形成第二套入口真相 |
| 10 | MCP Sampling-with-tools 内嵌 agent loop | 2 | 3 | 4 | 5 | **Reject** | 与 Codex Goal、DX subagents、执行图重复，并扩大工具授权和上下文泄漏面 |
| 11 | 再造独立视频渲染/粗剪/全帧审片能力 | 1 | 5 | 5 | 4 | **Reject** | 这些关键模式已由现有渲染、证据粗剪和复审链覆盖 |

## Adopt：标准 MCP App Production Canvas

### 为什么现在做

MCP Apps 规范已于 2026-01-26 标为 Stable，定义了 UI Resource、工具—UI 绑定、JSON-RPC iframe bridge、应用专用工具可见性、CSP、host context、尺寸、主题、显示模式、取消和 teardown。OpenAI 官方文档也明确建议优先采用 MCP Apps 标准，再叠加 ChatGPT 专有增强。

本仓库已经使用正确 MIME、`ui://` URI 和嵌套 `_meta.ui`，因此不是重写 Canvas，而是补齐协议闭环：

```text
当前：MCP tool metadata → inline HTML → window.openai
目标：MCP Apps capability → UI resource → App/PostMessageTransport → standard events/tools/resources
```

完整 side Browser Canvas 继续承载大图谱、长时间线、编辑器和本地 HTTP 流媒体；标准 inline App 只承担当前 Run 摘要、审批/阻塞、可播放小预览、审片证据跳转和安全的 app-only 操作。两者共享同一持久 Run，不产生第二状态源。

### 首选 feature 的验收标准

1. `initialize` 读取客户端 capability；仅在 host 声明 `extensions["io.modelcontextprotocol/ui"]` 且支持 `text/html;profile=mcp-app` 时暴露 UI 绑定，同时保留文本/结构化降级。
2. `app/canvas.html` 不再直接依赖 `window.openai`；使用标准 `App` 生命周期，先注册 `ontoolinput`、`ontoolresult`、`ontoolcancelled`、`onhostcontextchanged`、`onteardown`，再连接。
3. App 使用 `getHostCapabilities()` 做 feature detection；工具调用走 `callServerTool()`，资源读取走 `readServerResource()`，不假定某个宿主全量实现。
4. 公开 Canvas 工具使用 `_meta.ui.resourceUri`；凭据注入、刷新、审片定位等 UI 动作必须是 `visibility:["app"]` 或最小必要可见性，模型工具表不因 UI 增加噪声。
5. UI Resource 明确声明最小 CSP；默认不允许外部连接、iframe、摄像头、麦克风或地理位置。任何新增域名/权限必须有测试与理由。
6. 增加受控 Resource Template，例如 `directorx://runs/{runId}/artifacts/{artifactRef}`；只返回当前 Run 已注册、SHA 匹配、允许预览的文件，拒绝路径穿越、任意本地文件和跨 Run 读取。
7. 图片/联系表/短音频/小型视频可用 `blob` Resource 播放；大媒体采用明确上限和 side Browser handoff，不把最终长视频无界 base64 塞进 MCP 响应。
8. Inline App 响应 host theme、locale、safe area、container dimensions 与 inline/fullscreen 能力；自动尺寸变化不造成抖动或无限 resize loop。
9. 用户在 App 中显式选中的 shot、timecode 或 defect 可通过标准 model-context update 供后续对话使用；该通道只能补充上下文，不能满足审批、预算或交付门。
10. App 收到取消或 teardown 后停止未完成读取、释放 Object URL、清空密码输入，不持久化凭据或媒体字节。
11. 同一 Run 在 inline App 与 side Browser 间切换后，stage、approval、artifact revision 和审片定位一致；不复制 Run 状态。
12. 至少覆盖三类宿主测试：MCP Apps reference basic-host、OpenAI/ChatGPT 兼容路径、无 UI capability 的纯 MCP client。
13. 回归测试验证：app-only 工具不出现在模型工具列表、CSP/visibility 正确、资源越权失败、结构化结果匹配 schema、旧 side Browser 流程不退化。

### 实施边界

- 不把 `browser-canvas.html` 或 OpenCut 全量塞进 inline iframe。
- 不以标准化为理由删除 OpenAI invocation 状态字段；可作为兼容增强保留，但标准行为不能依赖它们。
- 不新增第二个 Run store、第二个 MCP Runtime 或前端私有生产状态。
- `@modelcontextprotocol/ext-apps` 若作为生产依赖引入，需单独审批；也可评估构建期打包后保持运行时零依赖，但不得手写一个不完整的私有协议分叉。

## Defer / Reject 说明

### MCP Tasks：继续保持 fail-closed

官方 2025-11-25 规范把 Tasks 定义为适合昂贵计算、批处理和外部 Job API 的持久状态机，理论上与 Director X Provider jobs 完美匹配。但该能力仍被标记为 experimental；本仓库也已经拥有 capability/source/behavior probe 和 polling fallback，并明确把 server methods 标为未就绪。

因此本轮不应只补 `tasks/get/list/result/cancel` 后宣称完成。等待 Codex host 暴露稳定 capability 且 MCP 下一 wire revision 定型后，再把 Provider job、渲染、转写、全帧审计映射为协议任务，并保留现有 durable polling fallback。

### Sampling 与重复视频能力：拒绝

Sampling-with-tools 会把另一个 agent loop 放进 MCP Server，重复 Codex/DX 的授权、并发、成本和恢复机制。高质量视频 Agent 源码显示的 transcript-first、按需视觉证据、确定性 HTML 渲染、approval → execute → self-eval → persist 等模式，本仓库均已有对应实现；唯一仍值得后续吸收的视频模式，是把用户已批准的时间线和审片证据编译为带参数槽、版权/来源、Provider 假设、审批 lineage 和质量门的可复用 Style Skill，而不是再造渲染或编辑子系统。

## 一手来源与快照

### OpenAI

- [MCP Apps compatibility in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt/)：OpenAI 官方说明标准 MCP Apps bridge 与 ChatGPT 扩展的边界。
- [`openai/openai-apps-sdk-examples` @ `18cc38e`](https://github.com/openai/openai-apps-sdk-examples/tree/18cc38e78a968712c357bacdc3c79fead5bfc6b4)：`mcp_app_basics_node` 展示 tool result、server tool call、host capabilities/context、display mode 和 partial input。
- [`openai/plugins` @ `11c74d6`](https://github.com/openai/plugins/tree/11c74d6ba24d3a6d48f54a194cd00ef3beea18f9)：官方插件仓库的 Manifest/MCP/Skills 产品组合基线。

### MCP 官方

- [`modelcontextprotocol/ext-apps` spec @ `2ca6a59`](https://github.com/modelcontextprotocol/ext-apps/blob/2ca6a59d2f493b227a83a2e3ce0396db4705621a/specification/2026-01-26/apps.mdx)：Stable MCP Apps 规范、能力协商、visibility、CSP、生命周期和 host context；可实施稳定点为 `v1.7.4` / `ca1d29894fabbd1558885a9ec8620dcb01d7457e`。
- [OpenAI App → MCP App migration @ `2ca6a59`](https://github.com/modelcontextprotocol/ext-apps/blob/2ca6a59d2f493b227a83a2e3ce0396db4705621a/docs/migrate_from_openai_apps.md)：`window.openai` 到 `App`/事件 API 的官方迁移映射。
- [Video Resource example @ `2ca6a59`](https://github.com/modelcontextprotocol/ext-apps/tree/2ca6a59d2f493b227a83a2e3ce0396db4705621a/examples/video-resource-server)：标准 App 通过 Resource Template 与 `blob` 播放视频的官方示例。
- [MCP Tasks 2025-11-25 @ `46fa519`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/46fa5192d4969f51ecea9896f7211a67d147f803/docs/specification/2025-11-25/basic/utilities/tasks.mdx)：任务用途、协商、状态、结果和 experimental 标记。
- [MCP Progress @ `46fa519`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/46fa5192d4969f51ecea9896f7211a67d147f803/docs/specification/2025-11-25/basic/utilities/progress.mdx)：长任务 progress token 与单调进度通知。
- [MCP TypeScript SDK @ `f413763`](https://github.com/modelcontextprotocol/typescript-sdk/tree/f4137630c05dc9a4fb14d4d3777f5cb167bd6313)：协议版本分代与 wire-era gating 的官方实现证据。

### 高质量视频 Agent / Agent-native video

- [`heygen-com/hyperframes` @ `32c41ea`](https://github.com/heygen-com/hyperframes/tree/32c41ea7dca14cfa6aa781335ccdd7870e52ceb4)：确定性、可 seek 的 HTML/CSS/media → MP4；本仓库已采用。
- [`browser-use/video-use` @ `92c2b34`](https://github.com/browser-use/video-use/tree/92c2b34e44c205cbc2acae7f6ca7c1c219d5dd66)：transcript-first、按需视觉证据、cut-boundary self-eval；本仓库已有对应能力。
- [`FireRedTeam/FireRed-OpenStoryline` @ `0429770`](https://github.com/FireRedTeam/FireRed-OpenStoryline/tree/04297707e7607dd398e906262235d0797068e7b4)：对话式编辑、技能归档、ASR 粗剪和首尾帧转场；不构成新的独立缺口。

## 最终建议

下一里程碑应是 `feature/standard-mcp-app-canvas`。完成后，Director X 会形成清晰的双界面架构：标准 MCP App 提供可移植、受控、可降级的伴随界面；Codex side Browser 提供完整视频制作工作台。随后再基于真实 Codex host capability 决定是否实现原生 MCP Tasks，而不是提前绑定仍在演进的任务 wire contract。

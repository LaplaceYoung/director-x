# Director X · Codex 插件

<p align="center">
  <strong>在 Codex 里拥有一支 AI 视频制片团队。</strong><br />
  你说想法，插件负责确认、调研、分镜、生成、剪辑、审计，直到你签收成片。
</p>

<p align="center">
  <a href="https://github.com/LaplaceYoung/director-x">GitHub 仓库</a> ·
  <a href="#快速安装">快速安装</a> ·
  <a href="#给-agent-的配置指南">Agent 配置指南</a> ·
  <a href="USAGE.zh-CN.md">中文使用指南</a> ·
  <a href="skills/directorx/SKILL.md">生产 Skill</a>
</p>

---

## 这个插件做什么

Director X 插件把 Codex 的原生 Agent 能力，接入一套完整的视频制片流程。安装后，你只需要对 Codex 说一句想做什么视频，插件就会：

- 弹出**原生确认窗口**，和你敲定目标、平台、预算等关键决定；
- **联网查资料、下载素材**，并记录每份素材的来源和版权；
- 派出**一支以 Director X 命名的子 Agent 团队**并行工作；
- 在**侧边栏画布**实时展示生产进度；
- 以 Codex **Goal** 为单位跑完「规划 → 生成 → 成片 → 审计」整个循环。

它不是另一个视频模型，也不改变 Codex 的交互习惯——所有能力都来自 Codex 原生功能，插件负责把它们组织成可靠的生产线。

## 五大核心能力

### 💬 1. 用 Codex 原生提问确认方案

每个重要决定——目标、平台、素材路线、Provider、精确模型、官方价格、预算上限、素材下载、最终交付——都通过 Codex 原生 **AskUserQuestion**（当前宿主工具名为 `request_user_input`）弹出确认窗口。

- 每次确认都有独立记录，可审计、可恢复；
- 聊天里说一句“好的”不算数，防止伪造确认；
- 预算、Provider、版权、交付分别确认，不会合并成一句模糊的“都同意”。

### 🌐 2. 用 Codex Agent 联网搜索、规划与取材

插件直接使用 Codex 的联网能力完成两类工作：

- **调研与规划**：搜索并打开品牌官网、产品页、平台规则、Provider 官方文档和价格页，所有搜索和打开行为留有回执；
- **联网获取资源**：经你授权后，把 Logo、产品图、参考图等下载到项目本地，计算文件哈希，登记来源、用途和版权状态。

网页链接、搜索摘要、缩略图都不会被直接当成成片素材——只有落盘、校验、登记过的文件才能进入画面。

### 🤝 3. 子 Agent 以 Director X 命名协作

Codex 的 `spawn_agent` 能力在插件里变成一支有名有姓的制片团队。你在画布和记录中看到的不是匿名并发任务，而是明确的角色分工：

| 角色 | 职责 |
| --- | --- |
| `DX-Director` | 总导演：解读意图、把控创意一致性、做阶段决策 |
| `DX-Task-Planner` | 拆解任务、规划并行波次 |
| `DX-Reference-Analyst` | 分析参考视频与资料，提取可复用的镜头和节奏 |
| `DX-Shot-Planner` | 分镜表、机位与镜头连续性设计 |
| `DX-Asset-Manager` | 素材下载、登记、版权台账 |
| `DX-Model-Router` | 为每个能力挑选 Provider 和精确模型 |
| `DX-Provider-Operator` | 执行 Provider 调用并保存回执 |
| `DX-Cost-Controller` | 报价、预算与花费控制 |
| `DX-Draw-Loop` | 生成重试的次数与止损控制 |
| `DX-Memory-Manager` | 角色、场景、风格的跨镜头连续记忆 |
| `DX-Editor` | 时间线、字幕、配音、转场与渲染 |
| `DX-Quality-Reviewer` | 全片质检与缺陷处置 |
| `DX-Approval-Producer` | 汇总待你批准的事项 |

即使 Codex 宿主只提供通用 Agent 类型，插件也会用兼容方式承载这些角色，并把 DX 身份写进生产记录和画布。

### 🖥️ 4. 侧边栏画布实时展示生产流程

生产开始后，插件会在 Codex 侧边栏打开一块 **Production Canvas**，把进度变成看得见的画面：

- **阶段进度**：当前进行到哪一步、下一步是什么、卡在哪里；
- **分镜与画面**：剧本、镜头、关键帧、候选画面和参考图；
- **时间线**：镜头边界、字幕、旁白、音乐和转场；
- **成本**：每个模型花了多少、预算还剩多少；
- **证据与审查**：素材来源回执、质检发现的问题和修复记录。

画布只是展示窗口，真正的生产状态全部保存在项目目录的 `.directorx/` 里，关掉标签页也不会丢。

### 🎯 5. 用 Codex Goal 跑完整生产循环

每支视频对应一个 Codex 原生 **Goal**。Goal 的完成条件不是“方案写好了”，而是成片真实交付：

```text
创建 Goal（你确认目标）
  │
  ▼
┌─ 生产循环 ──────────────────────────────────────┐
│  规划：调研 → 剧本 → 分镜                          │
│    → 生成：选模型 → 报价批准 → 生成与候选评审        │
│    → 成片：剪辑 → 字幕 → 配音配乐 → 渲染出片         │
│    → 审计：全片逐帧检查 → DX-Quality-Reviewer 复核   │
│       │                                        │
│       └── 未通过 → 回到对应阶段修复，重跑后续环节     │
│                                                  │
│  各阶段由 spawn_agent 派生的 DX 角色并行推进        │
└──────────────────────┬───────────────────────────┘
                       ▼
                你确认交付 → Goal 完成
```

任何一步失败都会保留现场：记录卡在哪、试过什么、怎么恢复。没有真实成片和质检证据，Goal 不会被标记完成。

## 快速安装

### 前置条件

- 支持插件、MCP、Goal、AskUserQuestion 和侧边 Browser 的 Codex 版本
- Node.js 22+、pnpm 11+
- FFmpeg 与 FFprobe
- 真实的生成类 Provider Key 可选（没有也能用 mock 和本地素材体验完整流程）

### 一键安装

在仓库根目录执行：

```bash
git clone https://github.com/LaplaceYoung/director-x.git
cd director-x
pnpm install
pnpm install:codex
```

`pnpm install:codex` 会自动完成：开启 Codex 原生 Goal、默认模式 `request_user_input` 及其底层工具注册、安装 DX 角色、安装媒体运行时、注册本地 `openmoss-local` 插件市场、安装并启用 `directorx` 插件。配置在任务宿主启动时读取，因此安装或升级后需要完整退出并重新打开 Codex 一次；仅新建任务不能刷新已经运行的旧宿主。

### 验证并重启

```bash
codex plugin list --json   # 应看到 directorx@openmoss-local 且为 enabled
pnpm doctor:codex-native-input  # 新建临时 Default 任务并等待真实原生提问事件
```

第二条命令只有在 App Server 收到 `item/tool/requestUserInput`、按原生结构返回答案且任务完成后才会通过。它验证的是可执行调用链，不是只检查配置文本或工具名称。

然后**完全退出 Codex 并重新打开**（仅新建对话不够），插件、DX 角色和 MCP 工具才会生效。

### 第一次使用

在新会话中输入：

```text
@directorx 制作一支 30 秒、9:16 的中文产品短视频。
请先询问平台、受众、素材路线、预算和 Provider 偏好，不要虚构产品能力或客户数据。
```

## 给 Agent 的配置指南

> 本节是写给 Agent 的执行合同：用户把本 README 交给你，让你安装、配置或使用插件时，严格按此执行。不要猜测 Provider、价格、版权状态或凭据。

### 1. 先判断任务模式

| 模式 | 你该做什么 |
| --- | --- |
| 安装 / 配置 | 按下方顺序安装并验证，最后提醒用户重启 Codex |
| 开发 / 测试 | 读 Skill 与 MCP 契约，运行构建和测试，不发起真实付费生成 |
| 新视频生产 | 读本节和 [`skills/directorx/SKILL.md`](skills/directorx/SKILL.md)，从 preflight 开始走完整流程 |
| 恢复生产 | 先读 `.directorx/` 下的 Run 快照和恢复计划，重新接管画布，不从聊天记录猜进度 |

### 2. 安装模式的执行顺序

```text
1. 读仓库根 AGENTS.md、主 README 和本文件
2. git branch --show-current 与 git status --short，确认分支和未提交改动
3. 检查 node(>=22)、pnpm(>=11)、ffmpeg、ffprobe
4. pnpm install（不无故升级锁文件）
5. pnpm install:codex
6. codex plugin list --json，确认 directorx 为 enabled
7. 提醒用户完全退出并重启 Codex
8. 新会话中确认 Director X 的 MCP 工具、Skills 和侧边 Browser 可用
9. 汇报：已完成项 / 缺失项 / 待用户确认项 / 阻塞原因
```

磁盘上存在插件文件 ≠ 配置完成。最低完成证据：依赖装好、插件 enabled、Codex 已完全重启、MCP 工具可发现。

### 3. 生产模式的第一个动作

生产任务不能从扫文件、写 Markdown 或直接 Web 搜索开始。必须：

1. 读取当前会话 `spawn_agent` 的输入 schema；
2. 调用 `directorx_capability_preflight` 做能力预检；
3. 用预检返回的 `browserCanvasUrl` 在 Codex 侧边 Browser 打开生产画布；
4. 画布就绪后，用 Codex 原生 AskUserQuestion 确认 Goal 与关键输入；
5. 创建 Run 并绑定 Goal——绑定成功前，不选流程、不问 Provider、不派 DX Agent。

### 4. 提问规则

- 高影响决定一律走 `directorx_request_user_interaction` → Codex 原生 `request_user_input` → `directorx_resolve_user_interaction` 的顺序；
- 预算、Provider、版权、交付各自独立确认；
- 工具因缺少原生确认而拒绝继续是**预期行为**，重新发起原生提问即可，不要在聊天里解释或绕过。

### 4.1 Codex 宿主能力协商

Director X 不再把“工具名出现过”直接等同于“生产能力可用”。Preflight 会分别登记当前会话的工具、Skill 与 `spawn_agent` schema，并生成可持久化的 `hostCapabilities`：

- `native_goal_lifecycle`：必须同时观察到 `create_goal`、`get_goal`、`update_goal`，防止任务只做前期文档就提前结束；
- `native_user_input`：高影响选择必须真正可调用 `request_user_input`，不能用聊天文字代替；
- `side_browser`：优先确认 `browser:control-in-app-browser` Skill。Browser 属于 Skill-backed 能力，直接工具清单未出现时状态保持 `unknown`，不会误判为不可用；
- `loop_execution`：Goal 生命周期配合 `exec` 或 `wait`/handoff 能力，使长制作过程可以持续、等待、恢复和审计；
- `typed_agent_schema`：只从当前 `spawn_agent` schema 的 `agent_type.enum`，或明确的 `collaboration_task` 合同获取，绝不从工具名猜测 DX Agent 类型。

状态语义固定为：

| 状态 | 含义 | 行为 |
| --- | --- | --- |
| `ready` | 当前会话已观察到完整能力 | 允许进入后续门禁 |
| `degraded` | 有可恢复路径但合同不完整 | 先修复或记录降级证据 |
| `unknown` | 宿主没有提供足够清单，或能力属于 Skill-backed | 不误报失败，先刷新清单/加载官方 Skill |
| `missing` | 当前已观察清单明确缺少必需能力 | 阻止创建 Run，返回可恢复动作 |

`hostToolNames`、`hostSkillNames` 只用于宿主能力证据；`availableAgentTypes` 始终独立传递。该边界可以防止把 `multi_agent_v1__spawn_agent`、`exec`、`request_user_input` 等工具名误当作 Agent 类型。

### 5. 联网与素材规则

- 调研：优先打开官方来源（官网、官方文档、官方价格页），不用搜索摘要下结论；
- 取材：经用户授权后下载到项目内，通过 `directorx_acquire_web_image_asset` 等工具完成本地落盘、哈希与版权登记；
- URL、缩略图、预览链接都不是交付素材。

### 6. DX 命名规则

- 派生子 Agent 时使用 DX 角色身份（见上方角色表），并把角色写进 Run、交接记录和画布；
- 宿主只提供内置 Agent 类型时，用兼容方式承载并记录宿主类型，不伪造新类型；
- 同一波次的无依赖任务一次全部派出；有依赖的任务等上游产物交接后再派；
- 不嵌套 spawn、不嵌套创建 Goal。

### 7. 不得做的事

- 不把 API Key 写进聊天、Git、日志或运行工件（Key 只走用户本地环境或画布安全密码框）；
- 不用聊天文字替代原生确认；不用 curl / fetch 冒充画布；
- 不跳过预算、版权、连续性和最终审计；
- 不为凑阶段数创建空内容占位文件；
- 不静默删除用户配置，不运行破坏性 Git 命令。

### 8. Remotion 成片必须来自单一时间线

Remotion 不再允许 Agent 手工重复填写镜头时长、顺序和转场。正式渲染顺序固定为：

- `semantic_timeline.json` 统一决定画面、旁白、音乐、音效与字幕的起止帧；
- `audio_cue_sheet.json` 作为音频编排来源指纹，任何改动都会让旧渲染投影失效；
- 每条时间线音轨必须绑定已登记在 Remotion `public/` 下的真实音频工件；插件会以 FFprobe 校验可播放性和实长，并锁定工件 SHA-256；
- 源音频短于时间线窗口、工件记录改变或渲染前文件被替换时，渲染会直接阻断，避免旁白和字幕在后半段突然消失；
- 音量包络使用合成级绝对帧，非零起点音轨也不会发生 ducking 漂移；
- 已批准旁白必须有完整音轨覆盖，字幕文本和时间必须与渲染质量合同逐条一致；
- `DirectorXTimeline` 只消费编译后的不可变投影，不在 React 渲染阶段重新猜测时长或字幕。

```text
semantic_timeline.json
  + render_quality_contract.json
  + transition_language_plan.json
  → directorx_compile_remotion_render_projection
  → remotion_render_props.json
  → DirectorXTimeline
  → directorx_render_remotion_video
```

- `mediaBindings` 只绑定已获取的本地媒体文件，不允许改写镜头时间；
- 转场帧窗、重叠、J/L Cut、Room Tone 和 Music Hit 由导演合同编译；
- 时间线、质量合同或转场方案的 SHA 在编译后变化，渲染会拒绝继续；
- `remotion_render_props.json` 被手工修改、换 Composition 或换 Runtime，同样会被拒绝。

### 9. Codex 宿主兼容与知识检索

- 可选原生 DX 角色由 `scripts/install-user-agents.mjs` 安装到 `~/.codex/agents`；插件安装器会优先完成这一步。
- 当宿主只提供 built-in `default`, `worker`, and `explorer` 类型时，插件把 DX 身份写入委派提示词、Run 与画布。
- 当宿主使用 `task_name/fork_turns/message` 协作接口时，插件使用 collaboration-task 传输并保持同样的 DX 身份与交接合同。
- None of these compatibility paths block Goal entry or require a restart；只有插件或 MCP 本体首次安装、升级时才按宿主要求重载。
- 侧边画布通过 claim-token `boot` heartbeat 证明真实打开；plain HTTP GET or forged token cannot satisfy the gate。
- Agent 在编剧、分镜、转场和 Remotion 规划前，可调用 `directorx_query_director_knowledge` 检索带来源与版权边界的导演知识条目。

## 生产文件在哪

```text
<你的项目>/.directorx/
├── plugin-preflights/      # 能力预检记录
├── plugin-runs/<run-id>/   # 每支视频的全部状态
│   ├── artifacts/          # 剧本、分镜、时间线等工件
│   ├── media/              # 下载与生成的媒体文件
│   ├── receipts/           # 搜索、下载、Provider 调用回执
│   ├── reviews/            # 质检与审计证据
│   └── production-memory/  # 跨镜头连续性记忆
└── benchmarks/             # 评测记录
```

聊天关了、Codex 重启了，这些文件都在；恢复生产从这里的快照继续。

## 常见问题

**插件列表里没有 directorx？**
确认在仓库根目录执行了 `pnpm install:codex`，再查 `codex plugin list --json` 的真实输出，最后完全重启 Codex。

**能看到 Skill，但 MCP 工具不生效？**
插件版本缓存未刷新。重新执行 `pnpm install:codex` 并完全重启 Codex（不是新建对话）。

**侧边画布打不开？**
确认 Codex 的 Browser 能力可用；生产的第一个动作必须是能力预检（preflight），并用返回的画布地址打开。

**我已经说过“确认”，工具却拒绝继续？**
这是预期行为——聊天文字不能替代原生确认。让 Agent 重新弹出原生确认窗口即可。

**画布里的角色名不是 DX- 开头？**
宿主会话可能只暴露内置 Agent 类型。只要 DX 身份写进了 Run 和画布记录，生产身份就成立；重启新会话后可获得完整 DX 类型。

## 更新与卸载

```bash
# 更新
pnpm install && pnpm install:codex
# 然后完全重启 Codex

# 卸载
codex plugin remove directorx@openmoss-local
```

如需移除用户级 DX 角色，请确认没有其他项目依赖 `~/.codex/agents` 中的 `dx_*` 文件后再删除。

## 插件开发

```bash
pnpm build && pnpm check && pnpm test           # 全量验证
node --test integrations/codex/directorx/mcp/*.test.mjs   # 仅插件 MCP 回归
```

关键目录：`.codex-plugin/`（插件清单）、`.mcp.json`（MCP 声明）、`skills/`（生产 Skills）、`mcp/`（工具实现）、`app/`（画布页面）、`config/`（DX 角色）、`runtime/`（媒体运行时）。

## 文档与许可

- [GitHub 仓库](https://github.com/LaplaceYoung/director-x)
- [中文使用指南](USAGE.zh-CN.md)
- [生产 Skill](skills/directorx/SKILL.md)
- `Director.md` 由每个生产 Run 在用户项目中生成
- [第三方声明](THIRD_PARTY_NOTICES.md)

AGPL-3.0-or-later。
# Director X Codex Plugin

## 2026-07-20 修复说明

- 最终视频、质量门、全帧审计、审片证据和交付清单统一绑定 `delivery.video` 与同一 SHA-256；preview 与 final 不再允许混用。
- 参考片授权交互现在包含来源 URL、参考 ID 和来源 hash 上下文；更换参考片时会生成独立请求，不会复用旧来源的授权状态。
- `delivery_manifest.json` 会在 Run 状态中持久化，完成门禁会检查其媒体身份是否和最终视频一致。
- 质量门仍然要求完整解码帧审计、镜头覆盖审查、DX-Quality-Reviewer 证据和原生交付确认；本地 fallback 只能形成 preview，不能伪装成正式交付。

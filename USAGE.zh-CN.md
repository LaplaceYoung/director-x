# Director X Codex 插件使用指南

这份指南面向公司内部安装、测试和日常视频制作。Director X 插件是 DirectorX 的 Codex 适配层，不会把 DirectorX 本体改造成插件。Codex 负责 Goal、原生提问、联网搜索、生图能力、侧边浏览器与子智能体；Director X 负责导演合同、制作流程、资产关系、模型与预算确认、连续性、剪辑、审片和交付门。

## 1. 安装

推荐使用公司一键安装方式，它会自动开启 Codex 原生 Goal 和默认模式 `request_user_input`，并一次准备插件、13 个 `DX-xxxxx` 角色和内置媒体运行时：

```bash
git clone https://github.com/LaplaceYoung/director-x.git
cd director-x
git switch codex/opencut-editor-integration
node scripts/install-directorx-codex.mjs
```

安装后完全退出并重新打开 Codex 一次。Codex 在任务创建时读取插件 MCP 和自定义 `spawn_agent` 类型，已经打开的任务无法热加载新增角色。

验证：

```bash
codex plugin list
node integrations/codex/directorx/runtime/doctor-media-runtime.mjs
pnpm doctor:codex-native-input
```

应看到 `directorx@openmoss-local` 已安装并启用，同时 Remotion、HyperFrames、Whisper 均为 ready。最后一条命令会启动一个临时 Default 模式任务，要求 Codex 真正发出 `item/tool/requestUserInput` 并完成结构化应答；只看到工具名称不算通过。

如果只想安装插件：

```bash
codex plugin marketplace add https://github.com/LaplaceYoung/director-x.git --ref main
codex plugin add directorx@openmoss-local
```

这种方式无法自动执行角色安装脚本，但不会阻塞制作。Director X 会优先使用已加载的 `dx_*` 角色；若当前任务尚未加载，则把 `DX-Reference-Analyst`、`DX-Shot-Planner` 等生产身份映射到 Codex 内置 `explorer`、`worker`、`default`，继续完成 Goal、画布和并行生产。内置 Agent 的宿主昵称只作为追踪信息，不会出现在画布和交付工件中。

## 2. 第一次调用

在新任务中输入：

```text
@directorx 为上海模思智能制作一支 15 秒宣传片
```

正确启动顺序：

1. 立即启动本地画布服务。
2. 在 Codex 侧边浏览器打开制作画布，而不是在会话内嵌画布。
3. 通过原生提示框确认进入 Director X Goal。
4. 对会改变成片的缺失信息，最多一次询问三个必要问题。
5. 生成并锁定项目核心文档 `Director.md`。
6. 按任务复杂度选择 quick、standard 或 complex 执行档。
7. 并行启动当前阶段可独立执行的 `DX-xxxxx` 子智能体。
8. 研究、脚本、分镜、生成、剪辑、逐帧审片和交付持续挂在同一个 Goal 与画布。

多镜头任务在分镜阶段还会生成“导演转场与镜头衔接”文档。它不是特效清单，而是逐边界说明为什么切、在哪里切、动作如何继续、声音如何提前或延后，以及 Remotion、HyperFrames 或 FFmpeg 应执行什么。

转场方案之后，插件还会执行一次“导演级镜头序列审查”。它会重新读取并绑定真实 `shotlist.json` 的哈希，确保审查与后续模型提示词使用同一套镜头 ID、顺序、目的和时长；代理不能临时传另一套漂亮参数来通过审查。审查还会检查钩子、铺垫、证明、反应和收束，镜头尺度与运动变化，轴线、视线和动作阶段，字幕与信息量，以及情绪能量曲线。无解释的穿轴、动作倒退、时长不符或装饰性运镜会阻止进入生成；有意破格必须写明导演理由并绑定证据，画布仍会把它显示为提醒。

如果只生成了策划文档、没有建立 Goal、没有打开侧栏或很快结束，说明启动合同没有满足。先在新任务重试；如果仍缺少 `directorx_capability_preflight`，重新安装插件并完全重启 Codex。

## 3. 原生确认与普通用户体验

以下内容必须通过 Codex 的 `request_user_input` 提示框完成，不能用普通聊天文本代替：

- 进入 Director X Goal；
- 视频用途、平台、画幅和制作路线；
- 图片、视频、语音、音乐的供应商与精确模型；
- 预算和付费调用；
- 外部参考视频下载；
- 权利不明确的网络素材下载；
- 影响叙事、时长、比例、音乐或权利的剪辑变更；
- 是否进入 Director X Cut；
- 最终交付。

一键安装器会自动在 `~/.codex/config.toml` 中开启以下能力。若使用纯 `codex plugin add` 安装，则需要手动确认：

```toml
[features]
default_mode_request_user_input = true
goals = true

[tools.experimental_request_user_input]
enabled = true
```

这些设置在任务宿主启动时读取。已经打开的任务可能继续持有旧的协作模式能力快照，无法靠插件或提示词在任务内部改写；安装或修改后应完整退出并重新打开 Codex 一次，再用 `pnpm doctor:codex-native-input` 验收。

## 4. 模型、Key 与预算

### 图片和视频模型

Director X 先让用户确认供应商和模型名称。内置目录没有该模型时，`DX-Model-Router` 会联网查找并打开供应商官方 API 文档，再建立受限的声明式适配。插件不会执行临时生成的 SDK 代码或任意脚本。

API Key 只粘贴到画布中的安全密码输入框。它仅注入当前插件进程环境，不写入项目、Run、日志、收据或 Git；Codex 重启后需要重新输入。

### MOSS-TTS

语音路线默认优先推荐 MOSS-TTS。没有 Key 时，Director X 会先用原生提示框询问是否前往 [MOSI 开放平台](https://platform.mosi.cn) 创建 Key；只有用户同意后才打开页面。Key 创建完成后回到画布安全输入框填写。

配置独立 TTS 后，视频模型不再负责旁白、对白或可理解语音。配置独立音乐后，视频模型不再负责背景音乐。只有两者都未配置且用户明确同意时，才允许视频模型统一生成完整声音。

### 预算

预算来自当前官方定价页和精确模型参数，包含分辨率、时长、质量档、输出数量和音频模式。缺少官方价格、价格过期、币种不一致或模型不匹配时，预算门会阻塞，不允许凭经验填写一个估算值。

## 5. 联网研究与资产

Director X 优先顺序：

1. 公司官网、官方文档和官方媒体；
2. 政府、学校、论文或权威报道；
3. 公共领域、可商用图库和视频库；
4. 需要单独确认的参考性来源。

Logo、产品图、地标、图片、视频和音乐只有在下载到本地、记录来源/许可并通过质量审计后，才是可使用资产。搜索结果 URL 和缩略图不算资产。

对版权状态不明确的素材，插件会先通过原生提示框说明来源、用途和风险并请求授权。用户提供参考视频链接时，会在授权后使用 yt-dlp 获取限定分析副本，提取全部解码帧、音频和元数据，由 `DX-Reference-Analyst` 学习节奏、镜头、运动、构图与声音结构；默认不复用源像素、声音、音乐、字幕、Logo 或文案。

## 6. 画布

画布有四个主要视图：

- 工作流：紧凑显示阶段、确认门、活动中的 DX 团队和完成门。
- 故事板：只显示生成的 Markdown、必要图片、视频和音频。
- 审片：播放成片、A/B 对比、时间轴、波形、字幕和逐帧缺陷。
- 活动：显示待确认问题、缺失证据、并行批次和制作事件。

故事板关系来自 `sourceArtifactRefs`，例如：

```text
品牌研究.md → 脚本.md → 关键画面.png
脚本.md → 旁白.wav
关键画面.png + 旁白.wav + 配乐.mp3 → 成片.mp4
```

JSON、执行收据、检查点、遥测、模型快照、逐帧审计图和 Benchmark 证据不会混入故事板。拖动、缩放、筛选、选中对象、审片播放头和时间轴范围会按 Run 保存；实时刷新不会自动把视图拉回固定位置。

侧栏每 5 秒发送心跳，隐藏标签仍视为健康。每个活动回合最后使用 `handoff` 保留标签；如果 Codex 回收了临时标签，下一次 Run 快照会返回同一 Run 的重绑定动作。

## 7. 并行 DX 团队

所有子智能体使用统一身份：

- `DX-Reference-Analyst`
- `DX-Asset-Manager`
- `DX-Shot-Planner`
- `DX-Provider-Operator`
- `DX-Model-Router`
- `DX-Cost-Controller`
- `DX-Editor`
- `DX-Quality-Reviewer`
- 以及目录中的其他 `DX-xxxxx` 角色。

执行图建立后，插件会返回同一批次的多个 `spawn_agent` 动作，Codex 必须先并发启动整批任务，再等待任何一个结果。运行时会记录真实开始/结束时间；只有执行区间存在重叠才算并行。阶段产物不能在对应批次尚未全部派发时由主代理抢先注册，阶段也不能在缺少重叠证据时完成。

## 8. quick、standard 与 complex

插件根据时长、镜头数、片段数、参考视频、人物连续性、模态和交付等级自动选择：

| 档位 | 典型任务 | 策略 |
| --- | --- | --- |
| quick | 15 秒以内、最多 4 镜、无参考复刻和人物连续性 | 每阶段最多 2 个 DX 任务、每镜最多 2 个候选、压缩阶段执行、一次导演编排加一次生成形成首版 |
| standard | 常规 30–60 秒宣传片 | 最多 4 路并发、每镜最多 3 个候选、关键帧审查 |
| complex | 长视频、多段首尾帧、参考复刻、人物/产品连续性 | 最多 6 路并发、场景门、连续性审查、每镜最多 4 个候选 |

这些限制由运行时强制执行；超出后必须重新评估为 standard 或 complex，不能在 quick 名义下静默增派 Agent 或增加抽卡。所有档位都必须生成 `Director.md`、完成原生确认、使用官方价格证据并执行最终全帧审计。quick 的含义是减少不必要的候选和研究宽度，不是降低交付标准。

## 9. 渲染、字幕与声音

内置运行时：

- Remotion：React/TSX 时间线、动态图表、字幕动画和复杂程序化动效。
- HyperFrames：HTML/CSS 场景、产品演示和轻量数据驱动画面。
- faster-whisper：本地转写和词级时间戳。
- FFmpeg/FFprobe：合成、探测、连续性、音频和逐帧审计。

渲染前必须通过 `render_quality_contract.json`：

- 旁白不能以过快语速塞进前半段；
- 除非声明片尾留白，旁白不能提前超过 2.5 秒结束；
- 字幕覆盖旁白并限制空档；
- 每个相邻视觉片段必须有转场；
- 每个转场必须与分镜阶段批准的导演方法、渲染类型和时长一致；
- 动作匹配的后一镜必须“继续动作”，不能从头再做一次；
- J Cut、L Cut 或环境声桥应作为独立声音决策保留；
- 静态图主导视频的无理由硬切比例不能过高；
- 自然转场时长保持在合理区间；
- 渲染器必须与合同一致。

渲染成功只代表得到预览文件。随后必须进入 review，执行完整解码帧覆盖、PTS/帧数一致性、黑白帧、闪帧、冻结、运动覆盖、A/V 时长、响度、峰值、权利和占位内容检查，再由 `DX-Quality-Reviewer` 审阅证据。

## 10. Director X Cut

成片通过技术检查和导演审片后，插件使用原生提示框询问是否需要继续剪辑。选择需要后，Director X Cut 会在侧边浏览器打开。

支持：

- 播放、缩放、拖动和时间轴浏览；
- 切分、裁剪、重排、删除；
- 字幕位移；
- 音量、旁白压低背景音乐；
- 归一化裁切；
- crossfade 和 dip-to-black；
- 撤销/重做、草稿保存和恢复。

编辑器只保存草稿。Codex 导入草稿后会再次通过原生提示框确认实质变更，批准后由 Core 提交、重渲染并重新执行全帧审计。旧的审片结果和交付批准不会沿用到新版本。

## 11. 常见问题

### 没有打开侧边栏

确认使用的是 Codex App，并在新任务调用 `@directorx`。如果 MCP App 内嵌画布出现而侧栏从未打开，说明启动合同失败；不要继续制作，重新安装插件并完全重启 Codex。

### 侧栏过一会儿消失

活动回合必须以 Browser `handoff` 结束。插件会持续返回重绑定动作并保留 Run；重新进入任务后继续，而不是复制旧的 loopback URL。

### 提示角色未加载

运行：

```bash
node integrations/codex/directorx/scripts/install-user-agents.mjs
```

然后完全退出并重新打开 Codex。角色文件存在不等于当前任务已经加载角色类型。

### 没有并行子智能体

检查画布“活动”里的并行批次。新版本会在计划和阶段开始响应中直接返回整批 `spawn_agent` 动作，并阻止主代理抢先注册这些任务拥有的产物。如果仍没有派发，保留该任务并运行 turn audit：

```bash
node integrations/codex/directorx/mcp/directorx-turn-audit.mjs /path/to/rollout.jsonl
```

### 渲染后任务很快结束

检查 Run 是否仍显示 `full_frame_audit_required`。新版本会返回强制的编辑阶段收口、review 启动和 `directorx_verify_final_media` 顺序；完成全帧检查与 `DX-Quality-Reviewer` 审阅前，Goal 不可完成。

### MOSI Key 无法使用

确认 Key 只填在画布安全输入框，并且当前 Codex 进程没有重启。重启后需要重新输入。不要把 Key 写入 `.env`、README、日志或聊天。

## 12. 卸载或升级

升级：

```bash
git pull
node scripts/install-directorx-codex.mjs
```

插件版本变化后完全重启 Codex。

卸载：

```bash
codex plugin remove directorx@openmoss-local
```

如需同时移除用户级 DX 角色和 `~/.directorx/media-runtime/`，请先确认没有其他 Director X 项目仍在使用；不要在制作中的 Run 里直接删除。

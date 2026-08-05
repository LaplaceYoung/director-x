# Director X

Director X 正在从零重建为一个轻量、贴合 Codex 的视频创作插件。

插件为 Codex 补充：

- 只展示图片、视频、音频和制作文本的侧边栏无限画布；
- 基于 `yt-dlp`、FFmpeg 和 FFprobe 的参考视频获取与理解；
- 从专业图片和视频工作流中提炼的视觉提示词写作能力；
- Codex 原生用户提问和专业多 Agent 协作；
- 简单可靠的 Remotion 合成与渲染能力。

Director X 不建设工作流引擎、数据库、MCP 编排层、第二套聊天系统或 Agent 状态图。

## 当前基础能力

初始化项目：

```bash
node scripts/directorx.mjs init --project /path/to/project
```

启动无限画布：

```bash
node scripts/directorx.mjs canvas --project /path/to/project
```

分析本地视频或用户确认的远程参考视频：

```bash
node scripts/directorx.mjs analyze \
  --project /path/to/project \
  --input /path/to/reference.mp4 \
  --title "参考宣传片"
```

把制作文本或项目内媒体加入画布：

```bash
node scripts/directorx.mjs add \
  --project /path/to/project \
  --type text \
  --title "分镜本" \
  --text "镜头一……"
```

## 开发

需要 Node.js 22 或更高版本。

```bash
npm run check
npm test
npm run validate:plugin
```

下一阶段将实现插件管理的 FFmpeg、FFprobe、yt-dlp Runtime 和 Remotion 模板。

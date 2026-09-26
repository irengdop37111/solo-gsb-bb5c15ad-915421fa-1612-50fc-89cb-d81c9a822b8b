# WebVTT 字幕校时台

本地运行的 WebVTT 字幕时间轴校对工具。可导入或粘贴 WebVTT，在与视频同步的时间轴上直接拖动字幕块与起止边界，支持自动吸附、连锁传播、撤销/重做，并导出修复后的 VTT。

技术栈：**React 18 + TypeScript + Vite**，纯前端实现，字幕与视频均在浏览器本地处理，不上传任何数据。

## 功能

- **导入 / 粘贴 VTT**：支持文件选择或直接粘贴 WebVTT 文本，容错解析（自动忽略 NOTE/REGION/STYLE 块，按起点排序）。
- **视频同步**：加载本地视频（可选），播放头实时映射到时间轴；点击标尺跳转，空格键播放/暂停。
- **拖拽校时**
  - 拖动字幕块整体平移；拖动左右边缘调整起点/终点。
  - **100ms 内自动吸附**播放头或任意相邻字幕的起止边界，显示黄色吸附指示线。
  - 时间轴可缩放（10–320 px/秒），拖动到边缘自动横向滚动。
- **连锁模式**（默认开启）
  - 拖出的重叠量逐条向相邻字幕传递（波纹推进），被推动的字幕保持时长。
  - 任意情况下始终保证：起点 `≥ 0`、每条时长 `≥ 300ms`、所有字幕互不重叠。
  - 关闭连锁模式时，字幕块会被相邻边界直接挡住。
- **字幕列表**：精确编辑时间戳与文本、单条新增/删除；正在播放的字幕高亮。
- **撤销 / 重做**：`Ctrl+Z` 撤销，`Ctrl+Shift+Z` / `Ctrl+Y` 重做；一次拖拽只产生一条历史。
- **导出**：一键下载修复后的 `fixed-subtitles.vtt`，或复制到剪贴板（保留原始 cue id）。

## 一条命令启动（Docker Compose）

```bash
docker compose up --build -d
```

启动后访问：

> **http://localhost:8080**

如需修改宿主机端口：

```bash
WEBVTT_PORT=9000 docker compose up --build -d
```

停止：

```bash
docker compose down
```

## 本地开发（无 Docker）

要求 Node.js 18+。

```bash
npm install
npm run dev
```

访问终端输出的地址（默认 http://localhost:5173 ）。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 使用说明

1. 打开页面后点击「导入 VTT」选择 `.vtt` 文件或粘贴内容；也可以点「载入示例」快速体验。
2. （可选）点击视频区加载本地视频文件。
3. 在时间轴上拖动字幕块或其左右边缘；靠近播放头/相邻边界时会自动吸附。
4. 用顶栏开关切换连锁模式；`Ctrl+Z / Ctrl+Shift+Z` 撤销重做。
5. 完成后点击「导出 VTT」下载，或「复制」取用文本。

## 项目结构

```
src/
  lib/
    engine.ts   # 校时引擎：连锁传播、不变量保证、100ms 吸附
    vtt.ts      # WebVTT 解析与序列化
    time.ts     # 时间戳解析/格式化、常量（300ms、100ms）
  hooks/
    useUndoable.ts  # 撤销/重做历史栈（支持拖拽批次与文本编辑合并）
  components/
    Timeline.tsx    # 时间轴：拖拽、缩放、标尺、播放头、吸附指示
    CueTable.tsx    # 字幕列表精确编辑
    VideoPlayer.tsx # 本地视频加载与同步
    ImportModal.tsx # VTT 导入/粘贴弹窗
  App.tsx
```

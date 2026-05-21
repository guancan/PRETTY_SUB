# PRETTY SUB

PRETTY SUB 是一个本地优先的字幕编辑与视频剪切工具。当前版本重点支持中文逐字/逐词时间戳编辑、豆包文件语音识别、可选说话人分离、字幕文本编辑、SRT 导出，以及基于剪切状态的本地视频预览/导出。

## 当前能力

- 上传音频或视频：支持 MP3、WAV、M4A、AAC、FLAC、OGG/OPUS、MP4、MOV、AVI、MKV、FLV、WMV 等常见格式。
- 语音识别：默认推荐豆包大模型录音文件极速版识别接口；保留 UniAPI Whisper 作为备选 provider。
- 分段与编辑：支持规则分段、AI 分段、词/字级选择、字幕文案编辑、整句剪切/删除/恢复、静音 gap 剪切。
- 说话人分离：识别前可开启“识别说话人”；支持 speaker 重命名、新增、归并、单句改 speaker。
- 预览与布局：Remotion Player 预览剪切后时间线；竖屏/音频场景下编辑器默认占更大宽度并支持拖动调节。
- 导出：支持普通 SRT、带 speaker 前缀 SRT、字幕/speaker 分轨 SRT、按 speaker 分拆 SRT、剪切视频导出、烧录字幕视频导出。

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript
- Server Actions：转写、AI 分段
- FFmpeg WASM：浏览器端音频抽取、剪切视频导出、烧录视频转码
- Remotion Player：本地预览剪切后视频与动态字幕
- @google/genai：通过 UniAPI Gemini 转发用于 AI 分段
- lucide-react：编辑器与导出 UI 图标

详细架构见 [TECHNICAL.md](./TECHNICAL.md)。

## 新机器接手流程

1. 安装 Node.js。

   建议使用 Node.js 20 LTS 或更新版本。当前依赖已在 `package-lock.json` 中锁定。

2. 安装依赖。

   ```bash
   npm install
   ```

3. 准备本地环境变量。

   ```bash
   cp env.example .env.local
   ```

   按实际 provider 填写 `.env.local`。不要提交 `.env.local`。

4. 启动开发服务。

   ```bash
   npm run dev
   ```

   默认访问 [http://localhost:3000](http://localhost:3000)。

5. 验证项目。

   ```bash
   npx tsc --noEmit
   npm run lint
   npm run build
   ```

   说明：当前 lint 可能会提示 `src/app/page.tsx` 中少量历史未使用变量 warning；这不影响本轮功能运行，但后续整理时可以单独清理。

## 环境变量

推荐本地使用 `doubao-flash`：

```dotenv
TRANSCRIPTION_PROVIDER=doubao-flash

DOUBAO_API_KEY=
DOUBAO_RESOURCE_ID=volc.bigasr.auc_turbo
DOUBAO_UID=pretty-sub-local
DOUBAO_RECOGNIZE_URL=https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash

UNIAPI_KEY=
GEMINI_SEGMENTATION_MODEL=gemini-2.5-flash
UNIAPI_GEMINI_BASE_URL=https://api.uniapi.io/gemini
DEBUG_AI_SEGMENTATION=false
```

字段说明：

- `TRANSCRIPTION_PROVIDER`：`doubao-flash` 或 `whisper`。当前主线建议使用 `doubao-flash`。
- `DOUBAO_API_KEY`：火山引擎语音服务 API Key，用于请求头 `X-Api-Key`。不要提交真实值。
- `DOUBAO_RESOURCE_ID`：豆包资源 ID，当前默认 `volc.bigasr.auc_turbo`。
- `DOUBAO_UID`：调用方用户标识，本地可使用 `pretty-sub-local`。
- `DOUBAO_RECOGNIZE_URL`：豆包极速版识别接口地址。
- `UNIAPI_KEY`：Whisper provider 和 Gemini 分段都可能使用。若只跑豆包识别但仍使用 AI 分段，也需要配置。
- `GEMINI_SEGMENTATION_MODEL`：AI 分段模型，默认 `gemini-2.5-flash`。
- `UNIAPI_GEMINI_BASE_URL`：UniAPI Gemini 转发地址。
- `DEBUG_AI_SEGMENTATION`：调试 AI 分段时才设为 `true`。

## 常用命令

```bash
npm run dev      # 启动本地开发服务
npm run build    # 生产构建
npm run start    # 运行生产构建
npm run lint     # ESLint 检查
npx tsc --noEmit # TypeScript 类型检查
```

## 代码结构

```text
src/app/page.tsx                  页面编排：上传、转写、分段、编辑、预览、导出
src/actions/transcribe.ts          语音识别 provider 调用与结果归一化
src/actions/aiSegment.ts           AI 分段 Server Action
src/components/SubtitleEditor.tsx  字幕编辑器主体
src/components/ExportPanel.tsx     SRT/视频导出入口
src/hooks/useAudioExtractor.ts     FFmpeg WASM 音频抽取
src/hooks/useVideoExporter.ts      剪切视频导出
src/hooks/useOverlayExporter.ts    烧录字幕视频导出
src/lib/segmentation.ts            字幕段、speaker、分段数据结构
src/lib/exportUtils.ts             SRT 构建与下载
src/lib/timelineUtils.ts           剪切时间线计算
src/lib/transcriptText.ts          中英文/标点拼接规则
src/remotion/*                     Remotion 预览与动态字幕渲染
src/locales/*                      中英文 UI 文案
docs/speaker-diarization-plan.md   说话人分离迭代计划与测试路径
ref/doubao/*                       豆包接口参考文档
```

## 媒体与导出注意事项

- 前端硬限制：文件最大 2GB，时长最大 30 分钟。
- 推荐范围：15 分钟以内、200MB 以内，处理体验更稳定。
- 音频文件可直接转写；视频文件会先在浏览器用 FFmpeg WASM 抽取音频。
- `next.config.ts` 为 Server Actions 配置了 `bodySizeLimit: '30mb'`，用于接收压缩后的音频 Blob。
- MP3/AVI 等常见格式可作为输入，但浏览器原生预览能力取决于本机浏览器支持；无法预览的视频仍可尝试抽音频转写。
- “剪切视频”和“导出带字幕视频”仅对视频文件开放；音频文件只导出 SRT。

## 协作约定

- 不提交 `.env.local`、日志、构建产物、`.next/`、`node_modules/`。
- 新 provider 接入时，先归一化到 `TranscriptionResponse`，不要让 UI 直接依赖 provider 原始响应。
- 字幕编辑状态以 `SubtitleSegment[]` 为主数据源；speaker 名称以应用级 `Speaker[]` 为准。
- 说话人分离是显式模式：只有用户开启“识别说话人”后，才展示和管理 speaker 信息。
- 高风险改动后至少跑 `npx tsc --noEmit`；涉及 UI/导出时补充一次浏览器或样例验证。

## 远程同步前检查

```bash
git status --short --branch
npx tsc --noEmit
npm run lint
npm run build
git log --oneline -5
```

确认 `.env.local` 没有被加入暂存区后，再执行 commit 和 push。

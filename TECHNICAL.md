# PRETTY SUB 技术框架说明

本文描述当前项目的真实架构、核心数据模型和扩展边界。开发接手时，先读本文件，再结合 [README.md](./README.md) 完成本地环境配置。

## 架构总览

```mermaid
flowchart LR
  F[音频/视频文件] --> M[媒体元数据解析]
  F --> A[音频 Blob]
  F --> P[本地预览 URL]
  M --> U[上传与处理状态]
  A --> T[Server Action: transcribeAudio]
  T --> R[TranscriptionResponse]
  R --> G[分段生成]
  G --> S[SubtitleSegment[]]
  S --> E[SubtitleEditor]
  S --> C[calculatePlayableClips]
  C --> V[Remotion Player 预览]
  S --> X[SRT / 视频导出]
```

项目是一个 Next.js 单页工作台。媒体文件保留在浏览器本地，服务端只接收抽取后的音频 Blob 用于语音识别或 AI 分段。编辑器、预览和导出都围绕同一份 `SubtitleSegment[]` 工作。

## 运行边界

- 浏览器端：文件选择、媒体预览、FFmpeg WASM 音频抽取、字幕编辑、Remotion Player 预览、视频导出。
- Server Actions：语音识别 provider 调用、Gemini 分段调用。
- 远程 API：豆包文件识别极速版、UniAPI Whisper、UniAPI Gemini 转发。
- 本地状态：React state + `useHistory` 撤销栈；当前没有后端数据库。

## Provider 策略

### 转写 provider

转写入口位于 `src/actions/transcribe.ts`，配置入口位于 `src/lib/config.ts`。

当前支持：

- `doubao-flash`：主线 provider。使用豆包大模型录音文件极速版识别接口，保留 utterance、word timestamp、speaker 信息。
- `whisper`：备选 provider。通过 UniAPI 调 OpenAI Whisper-1，保留 word timestamp；没有 speaker diarization。

无论 provider 原始响应如何，最终都必须归一化为：

```ts
export type TranscriptionWord = {
  word: string;
  originalWord?: string;
  start: number;
  end: number;
  kind?: 'speech' | 'punctuation';
  confidence?: number;
  speakerId?: string;
  channelId?: number;
};

export type TranscriptionUtterance = {
  text: string;
  start: number;
  end: number;
  wordStartIndex: number;
  wordEndIndex: number;
  speakerId?: string;
  channelId?: number;
};

export type TranscriptionResponse = {
  text: string;
  words: TranscriptionWord[];
  utterances?: TranscriptionUtterance[];
  provider: 'whisper' | 'doubao-flash';
  model?: string;
  logId?: string | null;
  speakerDiarizationEnabled?: boolean;
};
```

UI 层不应读取 provider 原始响应。新增 provider 时，先补归一化逻辑，再复用现有分段、编辑、预览和导出链路。

### AI 分段

分段入口由 `src/app/page.tsx` 调度：

- 豆包 provider：优先使用豆包返回的 utterances，并结合规则进一步控制字幕长度。
- 非豆包 provider：可走 `src/actions/aiSegment.ts` 的 Gemini 分段；失败时回退规则分段。

规则分段位于 `src/lib/segmentation.ts`，核心参数为：

```ts
export interface SegmentationOptions {
  maxCharsPerLine?: number;
  maxDurationSeconds?: number;
  punctuationSplit?: boolean;
  punctuationMinChars?: number;
}
```

## 核心数据模型

### SubtitleSegment

定义于 `src/lib/segmentation.ts`，是编辑器、预览和导出的主数据源。

```ts
export interface SegmentWord extends TranscriptionWord {
  color?: number;
  isDeleted?: boolean;
  isCut?: boolean;
  isGapCut?: boolean;
  displayGroupId?: string;
  textEditGroupId?: string;
  textEditOriginalText?: string;
}

export interface SubtitleSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words: SegmentWord[];
  yPosition?: number;
  speakerId?: string;
  speakerName?: string;
  channelId?: number;
}
```

语义：

- `isDeleted`：仅删除字幕文本，视频/音频仍保留。
- `isCut`：剪掉对应媒体片段，字幕也不显示。
- `isGapCut`：剪掉词前静音 gap。
- `color`：字幕文字颜色标记，不影响 speaker。
- `speakerId`：该句最终归属的说话人。
- `speakerName`：过渡字段；显示和导出优先读取应用级 `Speaker[]`。

### Speaker

```ts
export type SpeakerSource = 'provider' | 'manual';

export interface Speaker {
  id: string;
  name: string;
  source: SpeakerSource;
}
```

约定：

- provider 返回的 speaker id 直接作为 `Speaker.id`。
- 手动新增 speaker 使用本地生成 id。
- 字幕段只引用 `speakerId`，重命名只改 `Speaker.name`。
- 删除有字幕引用的 speaker 必须先归并到其他 speaker。
- 只要用户处于“区分说话人”模式，即使只有一个 speaker，也保留 speaker 管理入口。

### TimeRange

定义于 `src/lib/timelineUtils.ts`。

```ts
export interface TimeRange {
  start: number;
  end: number;
}
```

`calculatePlayableClips(segments, duration)` 从 `isCut` 和 `isGapCut` 计算剪切后的可播放片段。Remotion 预览、SRT 时间映射、剪切视频导出都依赖这一层。

## 主要模块职责

| 模块 | 职责 |
| --- | --- |
| `src/app/page.tsx` | 工作台状态编排；上传、转写、分段、编辑、预览、导出 |
| `src/actions/transcribe.ts` | 语音识别 provider 请求与响应归一化 |
| `src/actions/aiSegment.ts` | Gemini 分段请求、重试与回退 |
| `src/lib/config.ts` | 环境变量解析和 provider 配置 |
| `src/lib/segmentation.ts` | 分段规则、字幕段构建、speaker 数据类型 |
| `src/lib/transcriptText.ts` | 中英文、标点、空格拼接规则 |
| `src/components/SubtitleEditor.tsx` | 词/字/句编辑、speaker 管理、菜单交互 |
| `src/components/ExportPanel.tsx` | SRT、剪切视频、烧录视频导出入口 |
| `src/lib/exportUtils.ts` | SRT 构建、speaker 导出模式、下载 |
| `src/lib/timelineUtils.ts` | 剪切区间合并、原时间线到可播放时间线映射 |
| `src/hooks/useAudioExtractor.ts` | FFmpeg WASM 音频抽取 |
| `src/hooks/useVideoExporter.ts` | FFmpeg WASM 剪切视频导出 |
| `src/hooks/useOverlayExporter.ts` | Canvas + MediaRecorder + FFmpeg 烧录字幕导出 |
| `src/remotion/MainComposition.tsx` | 剪切后媒体序列渲染 |
| `src/remotion/DynamicCaptions.tsx` | 动态字幕和 speaker 前缀预览 |
| `src/contexts/LanguageContext.tsx` | 中英文 UI 文案 |

## 编辑操作语义

### 字/词编辑

编辑器显示的是 provider token 经过分组后的可操作单元。中文词可作为一个显示单元，仍允许词内单字选择。

- 词级剪切/删除：直接修改对应 word 状态。
- 词内单字剪切/删除：先按用户选择的字拆分显示词，再只处理选中部分。
- 文案编辑：修改字幕文本，不改变原始媒体时间轴；字数变化时按原时间范围重新分摊内部 token 时间。
- 恢复：按原始文本或原始状态还原。

### 整句编辑

句子左侧手柄菜单负责整句操作：

- 整句剪切（视频）：句内文字和可见 gap 一起进入剪切态。
- 整句删除（仅文本）：只隐藏文字，不剪媒体。
- 整句恢复：恢复文字和 gap 状态。
- 整句颜色：批量作用于句内字幕文字，不作用于 gap。
- 位置调整：控制单句 `yPosition`。

### 拆分与合并

- Enter 拆分字幕：拆出的前后两段继承原字幕段 `speakerId / speakerName / yPosition`。
- 合并字幕：默认使用靠前句子的 speaker。
- 用户可在单句左侧单独改 speaker。

## 说话人模式

说话人分离是显式模式：

1. 用户在识别前开启“识别说话人”。
2. 前端请求 `transcribeAudio` 时传入 `enableSpeakerDiarization`。
3. 豆包请求体增加 `enable_speaker_info: true`。
4. 返回结果中的 `utterance.additions.speaker` 被归一化为 `speakerId`。
5. `Speaker[]` 从字幕段派生并进入应用级状态。

展示原则：

- 非说话人模式：不展示 speaker 管理能力。
- 说话人模式：只要有 `speakerId`，就展示 speaker 标签和管理入口。
- 单 speaker 也不隐藏，因为后续仍需要重命名、编辑和归并。
- speaker 标签属于编辑辅助；动态跳字仍只作用于正文字幕。

## 导出逻辑

SRT 导出位于 `src/lib/exportUtils.ts`，当前支持：

- 普通字幕 SRT：只导出台词。
- 内联 speaker SRT：格式为 `说话人：台词`。
- 分轨 SRT：下载一个纯字幕 SRT 和一个 speaker-only SRT。
- 按 speaker 拆分 SRT：每个有台词的 speaker 单独下载一个 SRT。

时间映射统一通过 `calculatePlayableClips` 和 `mapOriginalToPlayableTime` 完成，确保导出的 SRT 与剪切后时间线一致。

视频导出：

- 剪切视频：`useVideoExporter` 调 FFmpeg WASM，按 `TimeRange[]` 输出 MP4。
- 烧录字幕视频：`useOverlayExporter` 使用隐藏 video + canvas 画帧，再通过 MediaRecorder/FFmpeg 输出 MP4。
- speaker 样式烧录暂未作为高优完成项，后续可单独设计。

## 文件格式与限制

输入识别：

- 音频：MP3、WAV、M4A、AAC、FLAC、OGG、OGA、OPUS、WEBM
- 视频：MP4、WEBM、MOV、AVI、MKV、FLV、WMV

限制：

- 最大文件大小：2GB
- 最大时长：30 分钟
- 推荐大小：200MB 内
- 推荐时长：15 分钟内
- Server Action body：30MB，接收浏览器抽取后的音频 Blob

注意：格式识别不等于浏览器可预览。比如 AVI/MKV 可能可抽音频转写，但浏览器预览取决于编码支持。

## 配置与安全

环境变量只放 `.env.local`，该文件被 `.gitignore` 忽略。跨机器交接时使用 `env.example` 作为模板，不要把真实 key 写入文档或提交。

关键变量：

- `TRANSCRIPTION_PROVIDER`
- `DOUBAO_API_KEY`
- `DOUBAO_RESOURCE_ID`
- `DOUBAO_UID`
- `DOUBAO_RECOGNIZE_URL`
- `UNIAPI_KEY`
- `GEMINI_SEGMENTATION_MODEL`
- `UNIAPI_GEMINI_BASE_URL`
- `DEBUG_AI_SEGMENTATION`

## 已知技术债

- `src/app/page.tsx` 仍有若干历史未使用变量 warning。
- Whisper provider 的日志仍偏调试化，后续可以收敛为低噪声日志。
- `SubtitleEditor.tsx` 已承载大量交互状态，后续继续做功能时应优先抽出纯逻辑 helper 或 reducer。
- 视频烧录导出还没有完整接入 speaker 样式。
- 当前没有持久化项目文件；刷新页面会丢失编辑状态。

# 技术说明

本文梳理当前项目的数据结构与处理流程，便于协作与后续扩展。

## 产品功能清单

### 功能结构（按用户目标）
- 视频导入与预览：上传视频、解析元数据、生成预览 URL。
- 音频抽取：浏览器端加载 ffmpeg.wasm，提取音频 Blob。
- 语音转写：将音频发送至 UniAPI Whisper-1，获取逐词时间戳。
- 分段：优先调用 AI 分段优化（可用时），否则使用规则分段。
- 字幕编辑：对词/静音段进行删除、剪切、上色、位置调整，支持撤销重做。
- 剪辑预览：根据剪切结果生成可播放片段，在 Remotion 中拼接并叠字幕。

## 整体框架

### 架构速览
- 框架：Next.js App Router + React + TypeScript
- 客户端流程：视频上传、音频抽取（ffmpeg.wasm）、字幕编辑
- 服务端动作：调用 UniAPI Whisper-1 做音频转写
- 预览：Remotion Player + 动态字幕 + 剪辑后播放

### 概念模型（实体与关系）

```mermaid
flowchart LR
  V[原视频文件] --> M[视频元数据]
  V --> A[音频 Blob]
  A --> T[转写结果 TranscriptionResponse]
  T --> S[字幕段 SubtitleSegment[]]
  S --> P[可播放片段 TimeRange[]]
  S --> R[字幕渲染]
  P --> R
```

### 数据流图

```mermaid
flowchart LR
  A[视频文件] --> B[获取元数据]
  A --> C[ffmpeg.wasm 抽取音频]
  C --> D[音频 Blob]
  D --> E[Server Action: transcribeAudio]
  E --> F[TranscriptionResponse]
  F --> G[segmentWords 分段]
  G --> H[SubtitleSegment[]]
  H --> I[SubtitleEditor 编辑]
  H --> J[calculatePlayableClips]
  J --> K[可播放 TimeRange[]]
  K --> L[Remotion Player]
  L --> M[DynamicCaptions]
```

### 核心概念（数据视角）
- 转写结果：`TranscriptionResponse`，仅包含原始文本与逐词时间戳，不含编辑信息。
- 字幕段：`SubtitleSegment[]`，编辑与预览的唯一数据源，承载词级状态与位置。
- 可播放时间线：`TimeRange[]`，由字幕段上的剪切标记导出，用于重构播放序列。

### 关键概念与操作语义
- 转写结果：只描述“听到什么”和“何时听到”，不包含编辑状态。
- 字幕段：编辑与预览的唯一数据源，聚合词级状态、颜色与位置。
- 删除（`isDeleted`）：仅隐藏字幕文字，视频仍完整播放。
- 剪切（`isCut`）：对应时间范围从视频中移除，字幕也不显示。
- 静音剪切（`isGapCut`）：移除词前静音区间。

## 功能模块与数据结构细化

### 模块职责（按代码组织）
- `src/app/page.tsx`：流程编排与页面状态，驱动上传、转写、分段、编辑与预览。
- `src/hooks/useAudioExtractor.ts`：ffmpeg.wasm 加载与音频抽取。
- `src/actions/transcribe.ts`：服务端 action，负责调用 UniAPI 与结果解析。
- `src/actions/aiSegment.ts`：服务端 action，通过 UniAPI 转发的 @google/genai SDK 生成优化分段区间。
- `src/lib/segmentation.ts`：词到字幕段的分段策略实现。
- `src/lib/prompts/segmentationPrompt.ts`：AI 分段提示词模板。
- `src/components/SubtitleEditor.tsx`：编辑器 UI 与交互规则。
- `src/lib/timelineUtils.ts`：剪切区间合并与可播放时间线生成。
- `src/remotion/MainComposition.tsx` / `src/remotion/DynamicCaptions.tsx`：预览渲染与动态字幕。

### 核心数据结构

#### 转写结构
定义于 `src/actions/transcribe.ts`。

```ts
export type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
};

export type TranscriptionResponse = {
  text: string;
  words: TranscriptionWord[];
};
```

使用位置：
- `src/actions/transcribe.ts`：服务端 action 返回该结构，作为转写结果的标准格式。
- `src/lib/segmentation.ts`：`segmentWords(words)` 接收 `TranscriptionWord[]` 生成字幕段。
- `src/app/page.tsx`：页面状态 `transcription` 保存转写结果并触发分段与编辑流程。

#### 字幕结构
定义于 `src/lib/segmentation.ts`。

```ts
export interface SegmentWord extends TranscriptionWord {
  color?: number; // 0-3
  isDeleted?: boolean; // 文本删除，视频仍播放
  isCut?: boolean;     // 视频剪切，文本隐藏
  isGapCut?: boolean;  // 前置静音段被剪切
}

export interface SubtitleSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words: SegmentWord[];
  yPosition?: number; // 0-100，距顶部百分比
}
```

使用位置：
- `src/lib/segmentation.ts`：`segmentWords` 产出 `SubtitleSegment[]`。
- `src/components/SubtitleEditor.tsx`：编辑器以该结构为唯一真实数据源。
- `src/lib/timelineUtils.ts`：从 `SubtitleSegment[]` 中读取 `isCut/isGapCut` 计算可播放片段。
- `src/remotion/MainComposition.tsx`：作为 Remotion 输入，驱动剪辑预览。
- `src/remotion/DynamicCaptions.tsx`：渲染字幕与词级高亮，并尊重 `isDeleted/isCut`。
- `src/app/page.tsx`：页面状态 `segments` 贯穿编辑与预览。

#### 时间线结构
定义于 `src/lib/timelineUtils.ts`。

```ts
export interface TimeRange {
  start: number;
  end: number;
}
```

使用位置：
- `src/lib/timelineUtils.ts`：`calculatePlayableClips` 返回 `TimeRange[]`，代表剪辑后的可播放片段。
- `src/app/page.tsx`：计算预览总时长与 seek 映射（通过 `mapOriginalToPlayableTime`）。
- `src/remotion/MainComposition.tsx`：将 `TimeRange[]` 映射为 Remotion `Series` 序列。

#### 分段规则配置
定义于 `src/lib/segmentation.ts`，由前端配置并传入 `segmentWords`。

```ts
export interface SegmentationOptions {
  maxCharsPerLine?: number;
  maxDurationSeconds?: number;
  punctuationSplit?: boolean;
  punctuationMinChars?: number;
}
```

使用位置：
- `src/app/page.tsx`：作为页面状态，由“分段规则”弹窗配置与展示。
- `src/lib/segmentation.ts`：分段逻辑读取该配置并应用。

### 编辑器 UI 中间结构
由 `src/components/SubtitleEditor.tsx` 从 `SubtitleSegment[]` 计算生成，仅用于展示/选择，不持久化。

```ts
type ItemType = 'word' | 'gap';

interface UIItem {
  id: string;
  type: ItemType;
  text: string;
  start: number;
  end: number;
  isDeleted: boolean;
  isCut?: boolean;
  isGapCut?: boolean;
  color: number;
  segmentId: string;
  originalWordIndex?: number;
}
```

### 数据格式备注

#### TranscriptionWord
- `start`/`end` 以秒为单位（number，小数表示），通常来自 Whisper 的 word-level 时间戳。
- `word` 可能包含标点或大小写变体，顺序即原始语音顺序。

#### TranscriptionResponse
- `text` 为整段转写文本（字符串）。
- `words` 为逐词数组，顺序与时间线一致。

#### SegmentWord
- 继承 `TranscriptionWord`，在编辑器中附加状态位与颜色。
- `color` 取值 `0-3`，对应预设颜色；`0` 为默认色。
- `isDeleted` 仅隐藏字幕文本，视频仍播放。
- `isCut` 表示该词对应的视频片段被剪掉，字幕也不显示。
- `isGapCut` 表示该词前的静音间隔被剪掉。

#### SubtitleSegment
- `text` 为该段 `words` 拼接后的可读文本（以空格分隔）。
- `start`/`end` 取首词/末词时间戳。
- `yPosition` 为该段字幕的垂直位置百分比（0 顶部、100 底部），未设置时使用全局默认值。

#### TimeRange
- `start`/`end` 均为秒。
- 由剪辑逻辑计算得出，内部会进行合并与容差处理（约 0.05s）。

#### UIItem（编辑器内部）
- `type='gap'` 表示静音区间，`text` 为形如 `0.35s` 的时长字符串。
- `originalWordIndex` 指向该 gap 后方的词，用于将 gap 操作映射回 `SegmentWord`。
- `id` 以 `gap-<segmentId>-<wordIdx>` 或 `<segmentId>-word-<wordIdx>` 的模式生成。

## 处理流程

1) 上传与元数据
- 用户在 `src/app/page.tsx` 选择视频文件。
- `getVideoMetadata(file)` 读取宽高和时长，并创建预览用 Blob URL。

2) 音频抽取（客户端）
- `useAudioExtractor()` 加载 ffmpeg.wasm。
- `extractAudio()` 输出 mp3 Blob 供转写。

3) 转写（服务端动作）
- `transcribeAudio(formData)` 请求 UniAPI Whisper-1。
- 返回带词级时间戳的 `TranscriptionResponse`。

4) 分段
- 优先调用 AI 分段：传入词级时间戳与规则参考信息，返回更自然的分段区间；失败或不可用时回退规则分段。
- 规则分段：`segmentWords(words, options)` 将词按字符数、时长、标点等规则切分成 `SubtitleSegment[]`。
- 规则阈值来自前端可配置项（见“分段规则配置”），在生成字幕与重新分段时均生效。
- 默认阈值：`maxCharsPerLine = 25`，`maxDurationSeconds = 3.0`（可通过 `options` 覆盖）。
- 计数方式：`newLength = 当前累计字符 + 1(空格) + 当前词长度`；`duration = 当前词 end - 当前段 start`。
- 触发切分条件（任一满足即切分）：
  - `newLength > MAX_CHARS`
  - `duration > MAX_DURATION`
  - 当前词以标点结尾（`/[.!?。！？]$/`）且 `newLength > 10`
- 段落文本：`text` 为段内词用空格拼接后的结果。
- 段落时间：`start` 取首词 start，`end` 取末词 end。
- 初始词进入新段后不会继续判断本词是否切分（先起段，再累积判断后续词）。
- 分段时为每个词初始化增强字段：`color=0`、`isDeleted=false`（不设置 `isCut/isGapCut`）。

5) 编辑
- 在 `SubtitleEditor` 中对词/静音段标记删除或剪切，并支持上色与段落位置调整。
- 撤销/重做由 `useHistory` 管理。

6) 时间线计算
- `calculatePlayableClips(segments, videoDuration)` 收集 `isCut` 与 `isGapCut` 的区间并合并。
- 输出可播放 `TimeRange[]`；`mapOriginalToPlayableTime` 用于编辑器与预览的时间映射。

7) 预览渲染（Remotion）
- `MainComposition` 以 `Series` 拼接可播放片段。
- `DynamicCaptions` 渲染当前段字幕，隐藏 `isDeleted/isCut` 的词，并高亮当前词。

## 运行时状态（Page 级）
位于 `src/app/page.tsx`：
- `videoFile`, `videoUrl`, `videoMetadata`
- `audioBlob`, `transcription`
- `segments`（编辑与预览的唯一来源）
- `selectedFont`, `globalYPosition`

## 配置
- `UNIAPI_KEY`（见 `env.example`）用于转写与 AI 分段转发。
- `GEMINI_SEGMENTATION_MODEL` 用于 AI 分段模型选择（可选）。
- `UNIAPI_GEMINI_BASE_URL` 用于 UniAPI Gemini 转发地址（@google/genai SDK，默认已配置）。
- `next.config.ts` 设置 COOP/COEP，确保 wasm 隔离环境。

## 现状与限制
- 当前仅支持客户端编辑与预览，没有导出/渲染成片流程。
- 状态仅保存在内存中，没有持久化或项目保存/加载能力。

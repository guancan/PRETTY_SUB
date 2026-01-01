import type { SegmentationOptions } from '@/lib/segmentation';
import type { TranscriptionWord } from '@/actions/transcribe';

export const buildSegmentationPrompt = (params: {
  words: TranscriptionWord[];
  options: SegmentationOptions;
}): string => {
  const { words, options } = params;

  const maxChars = options.maxCharsPerLine ?? 25;
  const maxDuration = options.maxDurationSeconds ?? 3.0;
  const punctuationSplit = options.punctuationSplit ?? true;
  const punctuationMinChars = options.punctuationMinChars ?? 10;

  const wordLines = words
    .map((w, i) => `${i}|${w.word}|${w.start.toFixed(3)}|${w.end.toFixed(3)}`)
    .join('\n');

  return `你是字幕分段引擎。你的任务是：基于词级时间戳与分段规则，输出更符合自然语言断句的分段结果。

分段规则（软约束，尽量遵守）：
- 单段最大字符数：${maxChars}
- 单段最大时长（秒）：${maxDuration}
- 是否允许标点触发切分：${punctuationSplit ? '是' : '否'}
- 标点触发的最小字符数：${punctuationMinChars}

要求：
- 只输出分段的索引范围，不要改写或新增词。
- 使用连续的词索引区间，必须覆盖全部词（从 0 到 N-1）。
- 分段应尽量符合自然语言语义与标点边界。
- 不要遗漏或重复任何词。

词列表（格式：index|word|start|end）：
${wordLines}
`;
};

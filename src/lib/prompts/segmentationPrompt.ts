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

  return `You are a subtitle segmentation engine. Your task is to output segmentation results based on word-level timestamps and segmentation rules.

Segmentation Rules (soft constraints, try to follow):
- Maximum characters per segment: ${maxChars}
- Maximum duration per segment (seconds): ${maxDuration}
- Allow punctuation-triggered splits: ${punctuationSplit ? 'Yes' : 'No'}
- Minimum characters for punctuation split: ${punctuationMinChars}

Requirements:
- Output ONLY the index ranges for segments, do not rewrite or add words.
- Use continuous word index ranges that must cover ALL words (from 0 to N-1).
- Segments should follow natural language semantics and punctuation boundaries.
- Do not omit or duplicate any word.
- You must respond with a valid JSON object (see example below).

Expected JSON format:
{
  "segments": [
    { "startIndex": 0, "endIndex": 5 },
    { "startIndex": 6, "endIndex": 12 }
  ]
}

Where:
- startIndex: the starting word index (inclusive, 0-based)
- endIndex: the ending word index (inclusive)

Word list (format: index|word|start|end):
${wordLines}
`;
};

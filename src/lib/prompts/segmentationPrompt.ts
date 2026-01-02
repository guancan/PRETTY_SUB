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

  return `You are an intelligent subtitle segmentation engine designed for optimal reading experience. Your task is to create segments that are semantically coherent and comfortable to read.

Core Principles (IMPORTANT - prioritize these over mechanical rules):
1. **Semantic Completeness**: Keep complete thoughts and phrases together. DO NOT break in the middle of:
   - Noun phrases (e.g., "the quick brown fox" should stay together)
   - Verb phrases (e.g., "has been working on" should stay together)
   - Prepositional phrases (e.g., "on the table" should stay together)
   - Subject-verb-object structures

2. **Natural Reading Rhythm**: Segment where natural pauses occur in speech, such as:
   - After complete clauses
   - Before significant topic shifts
   - At punctuation marks (periods, question marks, exclamation marks, commas when appropriate)

3. **Cognitive Load Management**: Readers should be able to:
   - Read each segment comfortably in one glance
   - Understand the complete meaning without rushing
   - Follow the narrative flow without fragmentation

Mechanical Constraints (use as guidelines, but semantic coherence takes priority):
- Maximum characters per segment: ${maxChars}
- Maximum duration per segment (seconds): ${maxDuration}
- Allow punctuation-triggered splits: ${punctuationSplit ? 'Yes' : 'No'}
- Minimum characters for punctuation split: ${punctuationMinChars}

Critical Requirements:
- Output ONLY the index ranges for segments, do not rewrite or add words.
- Use continuous word index ranges that must cover ALL words (from 0 to N-1).
- DO NOT omit or duplicate any word.
- Prioritize semantic meaning over strict adherence to character/time limits.
- When in doubt, prefer slightly longer segments that preserve meaning over shorter segments that break it.
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

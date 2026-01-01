import type { TranscriptionWord } from '@/actions/transcribe';

export interface SegmentWord extends TranscriptionWord {
    // Enhanced properties for the editor
    color?: number; // 0-3
    isDeleted?: boolean; // Text deleted, video plays
    isCut?: boolean;     // Video cut, text hidden
    isGapCut?: boolean;  // Preceding gap cut
}

export interface SubtitleSegment {
    id: string;
    text: string;
    start: number;
    end: number;
    words: SegmentWord[];
    yPosition?: number; // 0-100 percentage from top
}

export interface SegmentationOptions {
    maxCharsPerLine?: number;
    maxDurationSeconds?: number;
    punctuationSplit?: boolean;
    punctuationMinChars?: number;
}

export const DEFAULT_SEGMENTATION_OPTIONS: Required<SegmentationOptions> = {
    maxCharsPerLine: 25,
    maxDurationSeconds: 3.0,
    punctuationSplit: true,
    punctuationMinChars: 10,
};

export interface SegmentRange {
    startIndex: number;
    endIndex: number;
}

export const normalizeSegmentationOptions = (input: Partial<SegmentationOptions>): SegmentationOptions => {
    return {
        maxCharsPerLine: Math.max(1, input.maxCharsPerLine ?? DEFAULT_SEGMENTATION_OPTIONS.maxCharsPerLine),
        maxDurationSeconds: Math.max(0.1, input.maxDurationSeconds ?? DEFAULT_SEGMENTATION_OPTIONS.maxDurationSeconds),
        punctuationSplit: input.punctuationSplit ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationSplit,
        punctuationMinChars: Math.max(1, input.punctuationMinChars ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationMinChars),
    };
};

// Helper to init a SegmentWord with default editor flags.
const toSegmentWord = (w: TranscriptionWord): SegmentWord => ({
    ...w,
    color: 0,
    isDeleted: false
});

export function segmentWords(words: TranscriptionWord[], options: SegmentationOptions = {}): SubtitleSegment[] {
    const MAX_CHARS = options.maxCharsPerLine ?? DEFAULT_SEGMENTATION_OPTIONS.maxCharsPerLine; // 默认每行最大字符数
    const MAX_DURATION = options.maxDurationSeconds ?? DEFAULT_SEGMENTATION_OPTIONS.maxDurationSeconds; // 默认每段最大时长
    const PUNCT_SPLIT = options.punctuationSplit ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationSplit;
    const PUNCT_MIN_CHARS = options.punctuationMinChars ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationMinChars;

    const segments: SubtitleSegment[] = [];
    let currentWords: SegmentWord[] = [];
    let currentChars = 0;
    let currentStartTime = 0;

    words.forEach((word, index) => {
        // 1. Initialize first word of a segment
        if (currentWords.length === 0) {
            currentWords.push(toSegmentWord(word));
            currentChars = word.word.length;
            currentStartTime = word.start;
            return;
        }

        const prevWord = currentWords[currentWords.length - 1];

        // Logic to decide if we should split
        // Condition A: Time gap (silence) > 0.5s ? (Optional, maybe for later)
        // Condition B: Max characters exceeded
        // Condition C: Max duration exceeded

        // Check accumulated length
        const newLength = currentChars + 1 + word.word.length; // +1 for space
        const duration = word.end - currentStartTime;

        const shouldSplit =
            newLength > MAX_CHARS ||
            duration > MAX_DURATION ||
            (PUNCT_SPLIT && word.word.match(/[.!?。！？]$/) && newLength > PUNCT_MIN_CHARS); // End of sentence punctuation and reasonable length

        if (shouldSplit) {
            // Push current segment
            segments.push({
                id: crypto.randomUUID(),
                text: currentWords.map(w => w.word).join(' ').trim(),
                start: currentWords[0].start,
                end: currentWords[currentWords.length - 1].end,
                words: [...currentWords]
            });

            // Start new segment with current word
            currentWords = [toSegmentWord(word)];
            currentChars = word.word.length;
            currentStartTime = word.start;
        } else {
            currentWords.push(toSegmentWord(word));
            currentChars = newLength;
        }
    });

    // Push remaining words
    if (currentWords.length > 0) {
        segments.push({
            id: crypto.randomUUID(),
            text: currentWords.map(w => w.word).join(' ').trim(),
            start: currentWords[0].start,
            end: currentWords[currentWords.length - 1].end,
            words: [...currentWords]
        });
    }

    return segments;
}

export function buildSegmentsFromRanges(words: TranscriptionWord[], ranges: SegmentRange[]): SubtitleSegment[] {
    if (ranges.length === 0) return [];

    return ranges
        .map((range) => words.slice(range.startIndex, range.endIndex + 1))
        .filter((slice) => slice.length > 0)
        .map((slice) => ({
            id: crypto.randomUUID(),
            text: slice.map((w) => w.word).join(' ').trim(),
            start: slice[0].start,
            end: slice[slice.length - 1].end,
            words: slice.map(toSegmentWord)
        }));
}

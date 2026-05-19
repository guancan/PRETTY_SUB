import type { TranscriptionWord } from '@/actions/transcribe';
import { getTranscriptTextLength, isPunctuationText, joinTranscriptTokens } from './transcriptText';

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
    let currentStartTime = 0;

    const pushCurrentSegment = () => {
        if (currentWords.length === 0) return;
        segments.push({
            id: crypto.randomUUID(),
            text: joinTranscriptTokens(currentWords).trim(),
            start: currentWords[0].start,
            end: currentWords[currentWords.length - 1].end,
            words: [...currentWords]
        });
        currentWords = [];
        currentStartTime = 0;
    };

    words.forEach((word) => {
        const segmentWord = toSegmentWord(word);
        const isPunctuation = word.kind === 'punctuation' || isPunctuationText(word.word);

        // 1. Initialize first word of a segment
        if (currentWords.length === 0) {
            currentWords.push(segmentWord);
            currentStartTime = word.start;
            return;
        }

        if (isPunctuation) {
            currentWords = [...currentWords, segmentWord];
            const shouldSplitAfterPunctuation =
                PUNCT_SPLIT &&
                /[.!?。！？]$/.test(word.word) &&
                getTranscriptTextLength(currentWords) > PUNCT_MIN_CHARS;

            if (shouldSplitAfterPunctuation) {
                pushCurrentSegment();
            }
            return;
        }

        // Logic to decide if we should split
        // Condition A: Time gap (silence) > 0.5s ? (Optional, maybe for later)
        // Condition B: Max characters exceeded
        // Condition C: Max duration exceeded

        // Check accumulated length
        const nextWords = [...currentWords, segmentWord];
        const newLength = getTranscriptTextLength(nextWords);
        const duration = word.end - currentStartTime;

        const shouldSplit =
            newLength > MAX_CHARS ||
            duration > MAX_DURATION;

        if (shouldSplit) {
            pushCurrentSegment();
            // Start new segment with current word
            currentWords = [segmentWord];
            currentStartTime = word.start;
        } else {
            currentWords = nextWords;
        }
    });

    // Push remaining words
    if (currentWords.length > 0) {
        pushCurrentSegment();
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
            text: joinTranscriptTokens(slice).trim(),
            start: slice[0].start,
            end: slice[slice.length - 1].end,
            words: slice.map(toSegmentWord)
        }));
}

export function buildSegmentsFromProviderUtterances(
    words: TranscriptionWord[],
    utterances: { wordStartIndex: number; wordEndIndex: number }[]
): SubtitleSegment[] {
    return buildSegmentsFromRanges(
        words,
        utterances.map((utterance) => ({
            startIndex: utterance.wordStartIndex,
            endIndex: utterance.wordEndIndex,
        }))
    );
}

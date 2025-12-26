import { TranscriptionWord } from '@/actions/transcribe';

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
}

export interface SegmentationOptions {
    maxCharsPerLine?: number;
    maxDurationSeconds?: number;
}

export function segmentWords(words: TranscriptionWord[], options: SegmentationOptions = {}): SubtitleSegment[] {
    const MAX_CHARS = options.maxCharsPerLine || 30; // 默认每行最大字符数
    const MAX_DURATION = options.maxDurationSeconds || 3.0; // 默认每段最大时长

    const segments: SubtitleSegment[] = [];
    let currentWords: SegmentWord[] = [];
    let currentChars = 0;
    let currentStartTime = 0;

    // Helper to init a SegmentWord
    const toSegmentWord = (w: TranscriptionWord): SegmentWord => ({
        ...w,
        color: 0, // Default color 0 (white/standard)
        isDeleted: false
    });

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
            (word.word.match(/[.!?。！？]$/) && newLength > 10); // End of sentence punctuation and reasonable length

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

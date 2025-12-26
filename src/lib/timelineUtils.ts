import { SubtitleSegment } from './segmentation';

export interface TimeRange {
    start: number;
    end: number;
}

/**
 * Calculates the playable video clips based on subtitle segments.
 * It treats the video as a continuous timeline and subtracts the time ranges
 * of any words marked as `isDeleted`.
 * 
 * @param segments The list of subtitle segments
 * @param videoDuration The total duration of the original video in seconds
 * @returns Array of TimeRange representing the parts of the video to play
 */
export function calculatePlayableClips(segments: SubtitleSegment[], videoDuration: number): TimeRange[] {
    // 1. Collect all deleted ranges
    const deletedRanges: TimeRange[] = [];

    segments.forEach(seg => {
        seg.words.forEach(word => {
            if (word.isDeleted) {
                deletedRanges.push({ start: word.start, end: word.end });
            }
        });
    });

    if (deletedRanges.length === 0) {
        return [{ start: 0, end: videoDuration }];
    }

    // 2. Sort ranges by start time
    deletedRanges.sort((a, b) => a.start - b.start);

    // 3. Merge overlapping or adjacent deleted ranges
    const mergedDeleted: TimeRange[] = [];
    let current: TimeRange | null = null;

    for (const range of deletedRanges) {
        if (!current) {
            current = { ...range };
            continue;
        }

        // If overlaps or touches (with small tolerance for float precision)
        if (range.start <= current.end + 0.05) {
            current.end = Math.max(current.end, range.end);
        } else {
            mergedDeleted.push(current);
            current = { ...range };
        }
    }
    if (current) {
        mergedDeleted.push(current);
    }

    // 4. Invert to get playable clips
    const playableClips: TimeRange[] = [];
    let currentTime = 0;

    for (const deleted of mergedDeleted) {
        // If there is a gap between current time and deleted start, that's a clip
        if (deleted.start > currentTime + 0.05) {
            playableClips.push({ start: currentTime, end: deleted.start });
        }
        // Advance current time to end of deletion
        currentTime = Math.max(currentTime, deleted.end);
    }

    // Add final segment if remaining
    if (currentTime < videoDuration - 0.05) {
        playableClips.push({ start: currentTime, end: videoDuration });
    }

    return playableClips;
}

/**
 * Calculates the total duration of the edited video.
 */
export function calculateTotalDuration(clips: TimeRange[]): number {
    return clips.reduce((acc, clip) => acc + (clip.end - clip.start), 0);
}

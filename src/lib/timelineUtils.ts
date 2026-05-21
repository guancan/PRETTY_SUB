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
    // 1. Collect all CUT ranges (not just deleted)
    const deletedRanges: TimeRange[] = [];

    segments.forEach((seg, segIdx) => {
        // Collect end time of previous segment for gap calculation
        let prevEnd = 0;
        if (segIdx > 0 && segments[segIdx - 1].words.length > 0) {
            const prevSeg = segments[segIdx - 1];
            prevEnd = prevSeg.words[prevSeg.words.length - 1].end;
        }

        seg.words.forEach((word) => {
            // 1. Handle Preceding Gap Cut
            if (word.isGapCut) {
                // The gap is between prevEnd and word.start
                // Note: prevEnd is initialized to 0 for first word of first segment
                // Use Math.max to avoid negative ranges if timestamps are wonky
                const gapStart = Math.max(0, prevEnd);
                if (word.start > gapStart) {
                    deletedRanges.push({ start: gapStart, end: word.start });
                }
            }

            // 2. Handle Word Cut
            if (word.isCut) {
                deletedRanges.push({ start: word.start, end: word.end });
            }

            prevEnd = word.end;
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
/**
 * Maps an original video timestamp to the equivalent time on the playable (edited) timeline.
 * If the time falls within a cut, it snaps to the nearest valid playback point.
 * 
 * @param originalTime The timestamp in the original source video
 * @param clips The list of playable clips (calculated from segments)
 * @returns The timestamp on the playable timeline
 */
export function mapOriginalToPlayableTime(originalTime: number, clips: TimeRange[]): number {
    let accumulatedPlayableTime = 0;

    for (const clip of clips) {
        // 1. Time is before this clip (it's in a cut preceding this clip)
        if (originalTime < clip.start) {
            return accumulatedPlayableTime;
        }

        // 2. Time is inside this clip
        if (originalTime <= clip.end) {
            return accumulatedPlayableTime + (originalTime - clip.start);
        }

        // 3. Time is after this clip
        accumulatedPlayableTime += (clip.end - clip.start);
    }

    // If time is after all clips (end of video), return total duration
    return accumulatedPlayableTime;
}

import { SubtitleSegment } from './segmentation';
import { calculatePlayableClips, mapOriginalToPlayableTime, TimeRange } from './timelineUtils';
import { joinTranscriptTokens } from './transcriptText';

/**
 * Formats seconds into SRT timecode: HH:MM:SS,mmm
 */
function formatSrtTimecode(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export interface SrtSegment {
    index: number;
    start: string;
    end: string;
    text: string;
}

/**
 * Builds SRT segments from subtitle data.
 * Filters out deleted/cut words, remaps timestamps to trimmed timeline,
 * and produces clean subtitle blocks.
 */
export function buildSrtSegments(
    segments: SubtitleSegment[],
    videoDuration: number
): SrtSegment[] {
    const clips = calculatePlayableClips(segments, videoDuration);
    const srtSegments: SrtSegment[] = [];
    let index = 1;

    for (const seg of segments) {
        // Filter: keep only words that are neither deleted nor cut
        const visibleWords = seg.words.filter(w => !w.isDeleted && !w.isCut);
        if (visibleWords.length === 0) continue;

        const text = joinTranscriptTokens(visibleWords).trim();
        if (!text) continue;

        // Map original timestamps to the playable (trimmed) timeline
        const start = mapOriginalToPlayableTime(visibleWords[0].start, clips);
        const end = mapOriginalToPlayableTime(visibleWords[visibleWords.length - 1].end, clips);

        // Skip zero-duration segments
        if (end - start < 0.01) continue;

        srtSegments.push({
            index,
            start: formatSrtTimecode(start),
            end: formatSrtTimecode(end),
            text,
        });
        index++;
    }

    return srtSegments;
}

/**
 * Serializes SRT segments into a standard .srt string.
 */
export function serializeSrt(srtSegments: SrtSegment[]): string {
    return srtSegments
        .map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}`)
        .join('\n\n') + '\n';
}

/**
 * Triggers a browser download for a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Exports subtitle data as an SRT file download.
 */
export function exportSrt(
    segments: SubtitleSegment[],
    videoDuration: number,
    filename: string = 'subtitles.srt'
): void {
    const srtSegments = buildSrtSegments(segments, videoDuration);
    const srtText = serializeSrt(srtSegments);
    const blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, filename);
}

/**
 * Builds the FFmpeg concat filter command arguments for trimmed video export.
 * Uses the segment cutting data to determine which parts of the video to keep.
 * 
 * @returns An object with the FFmpeg arguments and the number of clips.
 */
export function buildFfmpegTrimArgs(
    clips: TimeRange[]
): { filterComplex: string; args: string[] } {
    if (clips.length === 0) {
        return { filterComplex: '', args: [] };
    }

    // Single clip: simple trim with -ss / -to (fastest, no re-encode needed for seeking)
    if (clips.length === 1) {
        const clip = clips[0];
        return {
            filterComplex: '',
            args: [
                '-i', 'input_video',
                '-ss', String(clip.start),
                '-to', String(clip.end),
                '-c', 'copy',
                'output_trimmed.mp4',
            ],
        };
    }

    // Multiple clips: use filter_complex with trim + concat
    // Build filter chains for video and audio
    const videoFilters: string[] = [];
    const audioFilters: string[] = [];
    const concatInputs: string[] = [];

    clips.forEach((clip, i) => {
        videoFilters.push(
            `[0:v]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS[v${i}]`
        );
        audioFilters.push(
            `[0:a]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS[a${i}]`
        );
        concatInputs.push(`[v${i}][a${i}]`);
    });

    const filterComplex = [
        ...videoFilters,
        ...audioFilters,
        `${concatInputs.join('')}concat=n=${clips.length}:v=1:a=1[outv][outa]`,
    ].join(';');

    return {
        filterComplex,
        args: [
            '-i', 'input_video',
            '-filter_complex', filterComplex,
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-c:a', 'aac',
            'output_trimmed.mp4',
        ],
    };
}

import { Speaker, SubtitleSegment } from './segmentation';
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

export interface SrtExportOptions {
    includeSpeakerName?: boolean;
    speakers?: Speaker[];
    speakerExportMode?: SrtSpeakerExportMode;
}

export type SrtSpeakerExportMode = 'inline' | 'separate' | 'per-speaker';

export interface SpeakerSubtitleSrtGroup {
    speakerId: string;
    speakerName: string;
    srtSegments: SrtSegment[];
}

const getSegmentSpeakerName = (segment: SubtitleSegment, speakers: Speaker[] = []): string | null => {
    if (!segment.speakerId) return null;
    const speaker = speakers.find((candidate) => candidate.id === segment.speakerId);
    return speaker?.name?.trim() || segment.speakerName?.trim() || null;
};

const getFilenameParts = (filename: string): { base: string; extension: string } => {
    const extensionIndex = filename.lastIndexOf('.');
    if (extensionIndex <= 0) return { base: filename, extension: '.srt' };
    return {
        base: filename.slice(0, extensionIndex),
        extension: filename.slice(extensionIndex),
    };
};

const getSpeakerTrackFilename = (filename: string): string => {
    const { base, extension } = getFilenameParts(filename);
    return `${base}_speakers${extension}`;
};

const sanitizeFilenamePart = (value: string, fallback: string): string => {
    const normalized = value
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return (normalized || fallback).slice(0, 80);
};

const getSpeakerSubtitleFilename = (
    filename: string,
    speakerName: string,
    speakerId: string,
    index: number,
    usedFilenames: Set<string>
): string => {
    const { base, extension } = getFilenameParts(filename);
    const safeName = sanitizeFilenamePart(speakerName, `speaker-${index + 1}`);
    const safeId = sanitizeFilenamePart(speakerId, String(index + 1));
    let suffix = safeName;
    let candidate = `${base}_${suffix}${extension}`;

    if (usedFilenames.has(candidate.toLowerCase())) {
        suffix = `${safeName}_${safeId}`;
        candidate = `${base}_${suffix}${extension}`;
    }

    if (usedFilenames.has(candidate.toLowerCase())) {
        candidate = `${base}_${suffix}_${index + 1}${extension}`;
    }

    usedFilenames.add(candidate.toLowerCase());
    return candidate;
};

const buildSrtSegmentsWithClips = (
    segments: SubtitleSegment[],
    clips: TimeRange[],
    options: SrtExportOptions = {}
): SrtSegment[] => {
    const srtSegments: SrtSegment[] = [];
    let index = 1;

    for (const seg of segments) {
        const visibleWords = seg.words.filter(w => !w.isDeleted && !w.isCut);
        if (visibleWords.length === 0) continue;

        const text = joinTranscriptTokens(visibleWords).trim();
        if (!text) continue;
        const speakerName = options.includeSpeakerName ? getSegmentSpeakerName(seg, options.speakers) : null;
        const displayText = speakerName ? `${speakerName}：${text}` : text;

        const start = mapOriginalToPlayableTime(visibleWords[0].start, clips);
        const end = mapOriginalToPlayableTime(visibleWords[visibleWords.length - 1].end, clips);

        if (end - start < 0.01) continue;

        srtSegments.push({
            index,
            start: formatSrtTimecode(start),
            end: formatSrtTimecode(end),
            text: displayText,
        });
        index++;
    }

    return srtSegments;
};

/**
 * Builds SRT segments from subtitle data.
 * Filters out deleted/cut words, remaps timestamps to trimmed timeline,
 * and produces clean subtitle blocks.
 */
export function buildSrtSegments(
    segments: SubtitleSegment[],
    videoDuration: number,
    options: SrtExportOptions = {}
): SrtSegment[] {
    const clips = calculatePlayableClips(segments, videoDuration);
    return buildSrtSegmentsWithClips(segments, clips, options);
}

/**
 * Builds a speaker-only SRT track aligned to the visible subtitle segments.
 */
export function buildSpeakerSrtSegments(
    segments: SubtitleSegment[],
    videoDuration: number,
    speakers: Speaker[] = []
): SrtSegment[] {
    const clips = calculatePlayableClips(segments, videoDuration);
    const srtSegments: SrtSegment[] = [];
    let index = 1;

    for (const seg of segments) {
        const visibleWords = seg.words.filter(w => !w.isDeleted && !w.isCut);
        if (visibleWords.length === 0) continue;

        const speakerName = getSegmentSpeakerName(seg, speakers);
        if (!speakerName) continue;

        const start = mapOriginalToPlayableTime(visibleWords[0].start, clips);
        const end = mapOriginalToPlayableTime(visibleWords[visibleWords.length - 1].end, clips);

        if (end - start < 0.01) continue;

        srtSegments.push({
            index,
            start: formatSrtTimecode(start),
            end: formatSrtTimecode(end),
            text: speakerName,
        });
        index++;
    }

    return srtSegments;
}

/**
 * Builds one subtitle SRT group per speaker.
 */
export function buildPerSpeakerSrtGroups(
    segments: SubtitleSegment[],
    videoDuration: number,
    speakers: Speaker[] = []
): SpeakerSubtitleSrtGroup[] {
    const clips = calculatePlayableClips(segments, videoDuration);
    const groups = new Map<string, { speakerId: string; speakerName: string; segments: SubtitleSegment[] }>();

    for (const seg of segments) {
        const visibleWords = seg.words.filter(w => !w.isDeleted && !w.isCut);
        if (visibleWords.length === 0) continue;
        if (!joinTranscriptTokens(visibleWords).trim()) continue;

        const speakerName = getSegmentSpeakerName(seg, speakers) || seg.speakerName?.trim() || 'Unknown Speaker';
        const speakerId = seg.speakerId || `unknown-${speakerName}`;

        if (!groups.has(speakerId)) {
            groups.set(speakerId, { speakerId, speakerName, segments: [] });
        }

        groups.get(speakerId)?.segments.push(seg);
    }

    return Array.from(groups.values())
        .map((group) => ({
            speakerId: group.speakerId,
            speakerName: group.speakerName,
            srtSegments: buildSrtSegmentsWithClips(group.segments, clips),
        }))
        .filter((group) => group.srtSegments.length > 0);
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
    filename: string = 'subtitles.srt',
    options: SrtExportOptions = {}
): void {
    if (options.includeSpeakerName && options.speakerExportMode === 'per-speaker') {
        const groups = buildPerSpeakerSrtGroups(segments, videoDuration, options.speakers);
        const usedFilenames = new Set<string>();
        groups.forEach((group, index) => {
            const groupFilename = getSpeakerSubtitleFilename(filename, group.speakerName, group.speakerId, index, usedFilenames);
            downloadBlob(new Blob([serializeSrt(group.srtSegments)], { type: 'text/plain;charset=utf-8' }), groupFilename);
        });
        return;
    }

    if (options.includeSpeakerName && options.speakerExportMode === 'separate') {
        const subtitleSegments = buildSrtSegments(segments, videoDuration, {
            ...options,
            includeSpeakerName: false,
        });
        const speakerSegments = buildSpeakerSrtSegments(segments, videoDuration, options.speakers);
        downloadBlob(new Blob([serializeSrt(subtitleSegments)], { type: 'text/plain;charset=utf-8' }), filename);
        downloadBlob(new Blob([serializeSrt(speakerSegments)], { type: 'text/plain;charset=utf-8' }), getSpeakerTrackFilename(filename));
        return;
    }

    const srtSegments = buildSrtSegments(segments, videoDuration, options);
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

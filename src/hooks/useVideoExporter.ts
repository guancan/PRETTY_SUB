import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { TimeRange } from '@/lib/timelineUtils';
import { downloadBlob } from '@/lib/exportUtils';
import Logger from '@/lib/logger';

export type VideoExportStage =
    | 'idle'
    | 'loading-ffmpeg'
    | 'writing-input'
    | 'trimming'
    | 'reading-output'
    | 'done'
    | 'error';

export interface VideoExportState {
    stage: VideoExportStage;
    progress: number; // 0-100
    error: string | null;
}

/**
 * Hook for exporting trimmed video using FFmpeg WASM.
 * Re-uses the same CDN-loaded FFmpeg core as audio extraction.
 */
export function useVideoExporter() {
    const [state, setState] = useState<VideoExportState>({
        stage: 'idle',
        progress: 0,
        error: null,
    });

    const ffmpegRef = useRef<FFmpeg | null>(null);
    const abortRef = useRef(false);

    const loadFfmpeg = async (): Promise<FFmpeg> => {
        if (ffmpegRef.current) return ffmpegRef.current;

        const ffmpeg = new FFmpeg();
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

        ffmpeg.on('log', ({ message }) => {
            Logger.debug(`[VideoExport FFmpeg] ${message}`);
        });

        ffmpeg.on('progress', ({ progress }) => {
            setState(prev => ({
                ...prev,
                progress: Math.min(95, Math.round(progress * 100)),
            }));
        });

        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });

        ffmpegRef.current = ffmpeg;
        return ffmpeg;
    };

    /**
     * Export trimmed video by applying cuts.
     * 
     * For ffmpeg.wasm, concat filter with trim is slow for large files.
     * Strategy: if only 1 clip, use simple -ss/-to with -c copy (fast, no re-encode).
     * If multiple clips, we trim each clip individually then concat via concat demuxer.
     */
    const exportTrimmedVideo = useCallback(async (
        videoFile: File,
        clips: TimeRange[],
        outputFilename: string = 'trimmed_video.mp4'
    ): Promise<void> => {
        if (clips.length === 0) {
            setState({ stage: 'error', progress: 0, error: 'No clips to export' });
            return;
        }

        abortRef.current = false;
        setState({ stage: 'loading-ffmpeg', progress: 0, error: null });

        try {
            const ffmpeg = await loadFfmpeg();
            if (abortRef.current) return;

            // Step 1: Write input file
            setState({ stage: 'writing-input', progress: 5, error: null });
            Logger.info(`[VideoExport] Writing input file: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`);
            await ffmpeg.writeFile('input_video', await fetchFile(videoFile));
            if (abortRef.current) return;

            // Step 2: Trim
            setState({ stage: 'trimming', progress: 10, error: null });

            if (clips.length === 1) {
                // Single clip: fast copy-based trim
                const clip = clips[0];
                Logger.info(`[VideoExport] Single clip trim: ${clip.start.toFixed(2)}s - ${clip.end.toFixed(2)}s`);
                await ffmpeg.exec([
                    '-i', 'input_video',
                    '-ss', String(clip.start),
                    '-to', String(clip.end),
                    '-c', 'copy',
                    '-movflags', '+faststart',
                    'output_trimmed.mp4',
                ]);
            } else {
                // Multiple clips: trim each, then concat via concat demuxer
                Logger.info(`[VideoExport] Multi-clip trim: ${clips.length} clips`);

                const fileListLines: string[] = [];

                for (let i = 0; i < clips.length; i++) {
                    if (abortRef.current) return;
                    const clip = clips[i];
                    const partName = `part_${i}.mp4`;

                    Logger.info(`[VideoExport] Trimming clip ${i + 1}/${clips.length}: ${clip.start.toFixed(2)}s - ${clip.end.toFixed(2)}s`);

                    await ffmpeg.exec([
                        '-i', 'input_video',
                        '-ss', String(clip.start),
                        '-to', String(clip.end),
                        '-c', 'copy',
                        '-avoid_negative_ts', 'make_zero',
                        partName,
                    ]);

                    fileListLines.push(`file '${partName}'`);

                    setState(prev => ({
                        ...prev,
                        progress: 10 + Math.round((i + 1) / clips.length * 70),
                    }));
                }

                // Write concat file list
                const concatList = fileListLines.join('\n');
                await ffmpeg.writeFile('filelist.txt', new TextEncoder().encode(concatList));

                // Concat all parts
                Logger.info('[VideoExport] Concatenating parts...');
                setState(prev => ({ ...prev, progress: 85 }));

                await ffmpeg.exec([
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', 'filelist.txt',
                    '-c', 'copy',
                    '-movflags', '+faststart',
                    'output_trimmed.mp4',
                ]);

                // Clean up part files
                for (let i = 0; i < clips.length; i++) {
                    try {
                        await ffmpeg.deleteFile(`part_${i}.mp4`);
                    } catch { /* ignore */ }
                }
                try {
                    await ffmpeg.deleteFile('filelist.txt');
                } catch { /* ignore */ }
            }

            if (abortRef.current) return;

            // Step 3: Read output
            setState({ stage: 'reading-output', progress: 95, error: null });
            const data = await ffmpeg.readFile('output_trimmed.mp4');
            const blob = new Blob([data as any], { type: 'video/mp4' });

            Logger.info(`[VideoExport] Output size: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);

            // Trigger download
            downloadBlob(blob, outputFilename);

            // Cleanup
            try {
                await ffmpeg.deleteFile('input_video');
                await ffmpeg.deleteFile('output_trimmed.mp4');
            } catch { /* ignore */ }

            setState({ stage: 'done', progress: 100, error: null });

        } catch (error: any) {
            Logger.error('[VideoExport] Export failed', error);
            setState({
                stage: 'error',
                progress: 0,
                error: error?.message || 'Export failed',
            });
        }
    }, []);

    const reset = useCallback(() => {
        abortRef.current = true;
        setState({ stage: 'idle', progress: 0, error: null });
    }, []);

    return {
        exportState: state,
        exportTrimmedVideo,
        resetExport: reset,
    };
}

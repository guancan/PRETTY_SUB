import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { SubtitleSegment, SegmentWord } from '@/lib/segmentation';
import { TimeRange, calculatePlayableClips, mapOriginalToPlayableTime } from '@/lib/timelineUtils';
import { downloadBlob } from '@/lib/exportUtils';
import Logger from '@/lib/logger';
import { shouldInsertSpaceBetweenTokens } from '@/lib/transcriptText';

// ── Types ──────────────────────────────────────────────────────────────────────

export type OverlayExportStage =
    | 'idle'
    | 'preparing'
    | 'recording'
    | 'converting'
    | 'done'
    | 'error';

export interface OverlayExportState {
    stage: OverlayExportStage;
    progress: number;     // 0-100
    error: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRESET_COLORS = ['#ffffff', '#f43f5e', '#22c55e', '#3b82f6'];

const TARGET_FPS = 30;

// ── Subtitle Renderer (Canvas 2D) ─────────────────────────────────────────────

/**
 * Renders the active subtitle overlay onto a canvas at the given original time.
 * Replicates the visual style from DynamicCaptions.tsx:
 * - Semi-transparent black pill background
 * - Per-word color + glow
 * - Active-word scale boost
 * - Global and per-segment Y position
 */
function renderSubtitleFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    originalTime: number,
    segments: SubtitleSegment[],
    fontFamily: string,
    globalYPosition: number
): void {
    // Find the active segment at this time
    const activeSegment = segments.find(
        seg => originalTime >= seg.start && originalTime <= seg.end
    );
    if (!activeSegment) return;

    // Filter visible words
    const visibleWords = activeSegment.words.filter(w => !w.isDeleted && !w.isCut);
    if (visibleWords.length === 0) return;

    const yPos = activeSegment.yPosition !== undefined ? activeSegment.yPosition : globalYPosition;

    // Scale factor: DynamicCaptions uses 48px at 1920-wide composition;
    // scale proportionally to the actual canvas width.
    const baseFontSize = Math.round(48 * (width / 1920));
    const padding = Math.round(16 * (width / 1920));
    const hPadding = Math.round(24 * (width / 1920));
    const wordGap = Math.round(16 * (width / 1920));
    const borderRadius = Math.round(16 * (width / 1920));

    // ── Measure total text width ────────────────────────────────────────────

    interface WordMeasure {
        word: SegmentWord;
        text: string;
        fontSize: number;
        fontWeight: string;
        color: string;
        isActive: boolean;
        width: number;
        gapAfter: number;
    }

    const measures: WordMeasure[] = [];
    let totalTextWidth = 0;

    for (let i = 0; i < visibleWords.length; i += 1) {
        const word = visibleWords[i];
        const nextWord = visibleWords[i + 1];
        const isActive = originalTime >= word.start && originalTime <= word.end;
        const colorIdx = word.color || 0;
        const color = PRESET_COLORS[colorIdx] || PRESET_COLORS[0];
        const fontWeight = word.color ? '800' : '600';
        const fontSize = isActive ? Math.round(baseFontSize * 1.05) : baseFontSize;

        ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", system-ui, -apple-system, sans-serif`;
        const tm = ctx.measureText(word.word);
        const w = tm.width;
        const gapAfter = shouldInsertSpaceBetweenTokens(word.word, nextWord?.word) ? wordGap : 0;

        measures.push({ word, text: word.word, fontSize, fontWeight, color, isActive, width: w, gapAfter });
        totalTextWidth += w + gapAfter;
    }

    const totalWidth = totalTextWidth;
    const pillWidth = totalWidth + hPadding * 2;
    const pillHeight = baseFontSize + padding * 2;

    const pillX = (width - pillWidth) / 2;
    const pillY = (height * yPos) / 100 - pillHeight / 2;

    // ── Draw pill background ────────────────────────────────────────────────

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    roundRect(ctx, pillX, pillY, pillWidth, pillHeight, borderRadius);
    ctx.fill();
    ctx.restore();

    // ── Draw words ──────────────────────────────────────────────────────────

    let cursorX = pillX + hPadding;
    const textY = pillY + padding + baseFontSize * 0.82; // baseline offset

    for (const m of measures) {
        ctx.save();

        ctx.font = `${m.fontWeight} ${m.fontSize}px "${fontFamily}", system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = m.color;
        ctx.globalAlpha = m.isActive ? 1 : 0.8;

        // Text shadow / glow
        if (m.word.color) {
            ctx.shadowColor = m.color;
            ctx.shadowBlur = Math.round(20 * (width / 1920));
        } else {
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowOffsetY = Math.round(2 * (width / 1920));
            ctx.shadowBlur = Math.round(4 * (width / 1920));
        }

        ctx.fillText(m.text, cursorX, textY);
        cursorX += m.width + m.gapAfter;

        ctx.restore();
    }
}

/** Helper: draw a rounded rectangle path. */
function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ── Main Hook ──────────────────────────────────────────────────────────────────

export function useOverlayExporter() {
    const [state, setState] = useState<OverlayExportState>({
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
            Logger.debug(`[OverlayExport FFmpeg] ${message}`);
        });

        ffmpeg.on('progress', ({ progress: p }) => {
            // Map FFmpeg progress to 60-95 range (conversion phase)
            setState(prev => ({
                ...prev,
                progress: Math.min(95, 60 + Math.round(p * 35)),
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
     * Export video with subtitles burned in.
     *
     * Pipeline:
     * 1. Create hidden <video> + <canvas>
     * 2. Play each clip in sequence, drawing video frames + subtitle overlay
     * 3. Capture the canvas stream via MediaRecorder → WebM blob
     * 4. Transcode WebM → MP4 via FFmpeg WASM
     * 5. Trigger download
     */
    const exportOverlayVideo = useCallback(async (
        videoFile: File,
        segments: SubtitleSegment[],
        videoDuration: number,
        fontFamily: string,
        globalYPosition: number,
        outputFilename: string = 'video_with_subtitles.mp4'
    ): Promise<void> => {
        abortRef.current = false;

        const clips = calculatePlayableClips(segments, videoDuration);
        if (clips.length === 0) {
            setState({ stage: 'error', progress: 0, error: 'No clips to export' });
            return;
        }

        setState({ stage: 'preparing', progress: 0, error: null });

        try {
            // ── Step 1: Set up hidden video element ────────────────────────────

            const videoUrl = URL.createObjectURL(videoFile);
            const videoEl = document.createElement('video');
            videoEl.src = videoUrl;
            videoEl.muted = false;
            videoEl.playsInline = true;
            videoEl.preload = 'auto';

            // Wait for metadata
            await new Promise<void>((resolve, reject) => {
                videoEl.onloadedmetadata = () => resolve();
                videoEl.onerror = () => reject(new Error('Failed to load video'));
            });

            const width = videoEl.videoWidth;
            const height = videoEl.videoHeight;

            Logger.info(`[OverlayExport] Video: ${width}x${height}`);

            // ── Step 2: Set up canvas ──────────────────────────────────────────

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;

            // ── Step 3: Set up MediaRecorder ───────────────────────────────────

            // Capture both video from canvas and audio from the video element
            const canvasStream = canvas.captureStream(TARGET_FPS);

            // Try to capture audio from the video element
            let combinedStream: MediaStream;
            try {
                const audioCtx = new AudioContext();
                const source = audioCtx.createMediaElementSource(videoEl);
                const destination = audioCtx.createMediaStreamDestination();
                source.connect(destination);
                source.connect(audioCtx.destination); // Also play to speakers so we can hear during recording

                // Combine canvas video track + audio track
                const audioTrack = destination.stream.getAudioTracks()[0];
                combinedStream = new MediaStream([
                    ...canvasStream.getVideoTracks(),
                    ...(audioTrack ? [audioTrack] : []),
                ]);
            } catch {
                Logger.warn('[OverlayExport] Could not capture audio, video-only export');
                combinedStream = canvasStream;
            }

            // Prefer VP9 for quality, fall back to VP8
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
                ? 'video/webm;codecs=vp9,opus'
                : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
                    ? 'video/webm;codecs=vp8,opus'
                    : 'video/webm';

            const recorder = new MediaRecorder(combinedStream, {
                mimeType,
                videoBitsPerSecond: Math.min(8_000_000, width * height * 4), // ~4 bits/pixel
            });

            const chunks: BlobPart[] = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            // ── Step 4: Play clips and record ──────────────────────────────────

            setState({ stage: 'recording', progress: 5, error: null });

            const totalDuration = clips.reduce((acc, c) => acc + (c.end - c.start), 0);

            // Start recording
            recorder.start(500); // collect chunks every 500ms

            // Process each clip sequentially
            for (let clipIdx = 0; clipIdx < clips.length; clipIdx++) {
                if (abortRef.current) break;

                const clip = clips[clipIdx];
                const clipDuration = clip.end - clip.start;

                // Seek to clip start
                videoEl.currentTime = clip.start;
                await new Promise<void>(resolve => {
                    videoEl.onseeked = () => resolve();
                });

                // Play this clip
                await videoEl.play();

                // Render loop for this clip
                await new Promise<void>((resolve) => {
                    let animId: number;

                    const drawFrame = () => {
                        if (abortRef.current) {
                            cancelAnimationFrame(animId);
                            resolve();
                            return;
                        }

                        const currentOriginalTime = videoEl.currentTime;

                        // Check if we've passed the end of this clip
                        if (currentOriginalTime >= clip.end - 0.02) {
                            videoEl.pause();
                            cancelAnimationFrame(animId);
                            resolve();
                            return;
                        }

                        // Draw video frame
                        ctx.drawImage(videoEl, 0, 0, width, height);

                        // Draw subtitle overlay
                        renderSubtitleFrame(
                            ctx, width, height,
                            currentOriginalTime,
                            segments, fontFamily, globalYPosition
                        );

                        // Update progress
                        const elapsed = clips
                            .slice(0, clipIdx)
                            .reduce((acc, c) => acc + (c.end - c.start), 0)
                            + (currentOriginalTime - clip.start);
                        const pct = Math.round((elapsed / totalDuration) * 50) + 5; // 5-55%
                        setState(prev => ({ ...prev, progress: Math.min(55, pct) }));

                        animId = requestAnimationFrame(drawFrame);
                    };

                    animId = requestAnimationFrame(drawFrame);
                });
            }

            // Stop recording
            videoEl.pause();
            const webmBlob = await new Promise<Blob>((resolve) => {
                recorder.onstop = () => {
                    resolve(new Blob(chunks, { type: mimeType }));
                };
                recorder.stop();
            });

            URL.revokeObjectURL(videoUrl);
            Logger.info(`[OverlayExport] WebM recorded: ${(webmBlob.size / 1024 / 1024).toFixed(1)}MB`);

            if (abortRef.current) return;

            // ── Step 5: Convert WebM → MP4 via FFmpeg ──────────────────────────

            setState({ stage: 'converting', progress: 58, error: null });

            const ffmpeg = await loadFfmpeg();
            if (abortRef.current) return;

            await ffmpeg.writeFile('recorded.webm', new Uint8Array(await webmBlob.arrayBuffer()));

            await ffmpeg.exec([
                '-i', 'recorded.webm',
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                '-pix_fmt', 'yuv420p',
                'output_overlay.mp4',
            ]);

            const data = await ffmpeg.readFile('output_overlay.mp4');
            const outputBuffer = typeof data === 'string'
                ? new TextEncoder().encode(data).buffer
                : new Uint8Array(data).buffer;
            const mp4Blob = new Blob([outputBuffer], { type: 'video/mp4' });

            Logger.info(`[OverlayExport] MP4 output: ${(mp4Blob.size / 1024 / 1024).toFixed(1)}MB`);

            // Cleanup FFmpeg FS
            try { await ffmpeg.deleteFile('recorded.webm'); } catch { /* */ }
            try { await ffmpeg.deleteFile('output_overlay.mp4'); } catch { /* */ }

            // ── Step 6: Download ───────────────────────────────────────────────

            downloadBlob(mp4Blob, outputFilename);
            setState({ stage: 'done', progress: 100, error: null });

        } catch (error: unknown) {
            Logger.error('[OverlayExport] Export failed', error);
            const message = error instanceof Error ? error.message : 'Export failed';
            setState({
                stage: 'error',
                progress: 0,
                error: message,
            });
        }
    }, []);

    const reset = useCallback(() => {
        abortRef.current = true;
        setState({ stage: 'idle', progress: 0, error: null });
    }, []);

    return {
        overlayExportState: state,
        exportOverlayVideo,
        resetOverlayExport: reset,
    };
}

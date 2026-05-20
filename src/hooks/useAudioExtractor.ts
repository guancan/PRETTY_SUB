import { useState, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import Logger from '@/lib/logger';

export function useAudioExtractor() {
    const [isReady, setIsReady] = useState(false);
    const [progress, setProgress] = useState(0);
    const ffmpegRef = useRef<FFmpeg | null>(null);

    const load = async () => {
        if (isReady) return;

        if (!ffmpegRef.current) {
            ffmpegRef.current = new FFmpeg();
        }
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        const ffmpeg = ffmpegRef.current;

        ffmpeg.on('log', ({ message }) => {
            Logger.debug(`FFmpeg log: ${message}`);
        });

        ffmpeg.on('progress', ({ progress }) => {
            setProgress(Math.round(progress * 100));
        });

        try {
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            setIsReady(true);
            Logger.info('FFmpeg loaded');
        } catch (e) {
            Logger.error('FFmpeg load failed', e);
        }
    };

    const extractAudio = async (videoFile: File): Promise<Blob | null> => {
        if (!isReady) await load();
        const ffmpeg = ffmpegRef.current;
        if (!ffmpeg) return null;

        const inputName = 'input_media';
        const outputName = 'output.mp3';

        try {
            Logger.info(`Starting audio extraction for ${videoFile.name}`);
            await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

            // Extract audio optimized for Whisper speech recognition
            // -ac 1: Convert to mono (single channel)
            // -ar 16000: 16kHz sample rate (Whisper's native rate)
            // -b:a 64k: 64 kbps constant bitrate (sufficient for speech)
            // -map 0:a:0: Extract the first audio track only
            await ffmpeg.exec([
                '-i', inputName,
                '-map', '0:a:0',
                '-acodec', 'libmp3lame',
                '-ac', '1',
                '-ar', '16000',
                '-b:a', '64k',
                outputName
            ]);

            const data = await ffmpeg.readFile(outputName);
            const outputBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
            const outputBuffer = outputBytes.buffer.slice(
                outputBytes.byteOffset,
                outputBytes.byteOffset + outputBytes.byteLength
            ) as ArrayBuffer;
            const blob = new Blob([outputBuffer], { type: 'audio/mpeg' });

            Logger.info('Audio extraction complete');
            return blob;
        } catch (error) {
            Logger.error('Extraction error', error);
            return null;
        } finally {
            await ffmpeg.deleteFile(inputName).catch(() => undefined);
            await ffmpeg.deleteFile(outputName).catch(() => undefined);
        }
    };

    return { load, isReady, extractAudio, progress };
}

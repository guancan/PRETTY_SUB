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

        try {
            Logger.info(`Starting audio extraction for ${videoFile.name}`);
            await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

            // Extract audio to mp3 (Whisper prefers mp3/wav) using efficient settings
            // -q:a 2 (high quality variable bit rate)
            // -map a (map audio only)
            await ffmpeg.exec(['-i', 'input.mp4', '-map', '0:a', '-acodec', 'libmp3lame', '-q:a', '2', 'output.mp3']);

            const data = await ffmpeg.readFile('output.mp3');
            const blob = new Blob([data as any], { type: 'audio/mp3' });

            Logger.info('Audio extraction complete');
            return blob;
        } catch (error) {
            Logger.error('Extraction error', error);
            return null;
        }
    };

    return { load, isReady, extractAudio, progress };
}

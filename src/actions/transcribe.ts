'use server';

import { config } from '@/lib/config';

export type TranscriptionWord = {
    word: string;
    start: number;
    end: number;
};

export type TranscriptionResponse = {
    text: string;
    words: TranscriptionWord[];
};

export async function transcribeAudio(formData: FormData): Promise<TranscriptionResponse | null> {
    const file = formData.get('file') as File;

    if (!file) {
        console.error('No file provided for transcription');
        return null;
    }

    // The user's requested endpoint and model
    const key = process.env.UNIAPI_KEY;
    if (!key) {
        throw new Error('UNIAPI_KEY is not set');
    }

    try {
        // We need to reconstruct the FormData because passing it directly 
        // from client to server action sometimes loses file content if not handled carefully,
        // but here we are receiving it. We will forward it to the external API.

        const apiFormData = new FormData();
        apiFormData.append('file', file);
        apiFormData.append('model', 'whisper-1');
        apiFormData.append('response_format', 'verbose_json'); // Crucial for timestamps
        apiFormData.append('timestamp_granularities[]', 'word'); // Crucial for word-level timestamps

        console.log('Sending audio to UniAPI Whisper-1...');

        const response = await fetch('https://api.uniapi.io/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                // Content-Type is set automatically with FormData
            },
            body: apiFormData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('UniAPI Error:', response.status, errorText);
            throw new Error(`Transcription failed: ${errorText}`);
        }

        const data = await response.json();
        console.log('Transcription success');
        console.log('[Transcribe] Full response keys:', Object.keys(data));
        console.log('[Transcribe] text length:', data.text?.length ?? 0);
        console.log('[Transcribe] words count:', data.words?.length ?? 0);
        console.log('[Transcribe] segments count:', data.segments?.length ?? 0);

        // Word-level timestamps (preferred)
        let words: TranscriptionWord[] = data.words?.map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end,
        })) ?? [];

        // Fallback: if Whisper didn't return word-level timestamps,
        // reconstruct from segment-level data (each segment becomes one "word")
        if (words.length === 0 && Array.isArray(data.segments) && data.segments.length > 0) {
            console.warn('[Transcribe] No word-level timestamps — falling back to segment-level timestamps');
            words = data.segments.map((seg: any) => ({
                word: seg.text?.trim() ?? '',
                start: seg.start,
                end: seg.end,
            })).filter((w: TranscriptionWord) => w.word.length > 0);
            console.log('[Transcribe] Reconstructed word count from segments:', words.length);
        }

        if (words.length === 0) {
            console.error('[Transcribe] Still 0 words after fallback. Raw data:', JSON.stringify(data).substring(0, 500));
        }

        // Parse the response to our standardized format
        return {
            text: data.text,
            words,
        };

    } catch (error) {
        console.error('Transcription Action Error:', error);
        throw error;
    }
}

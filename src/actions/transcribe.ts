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

        // Parse the response to our standardized format
        return {
            text: data.text,
            words: data.words?.map((w: any) => ({
                word: w.word,
                start: w.start,
                end: w.end,
            })) || [],
        };

    } catch (error) {
        console.error('Transcription Action Error:', error);
        throw error;
    }
}

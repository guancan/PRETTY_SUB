'use server';

import { config, type TranscriptionProvider } from '@/lib/config';
import { joinTranscriptTokens } from '@/lib/transcriptText';

export type TranscriptionTokenKind = 'speech' | 'punctuation';

export type TranscriptionWord = {
    word: string;
    start: number;
    end: number;
    kind?: TranscriptionTokenKind;
    confidence?: number;
};

export type TranscriptionUtterance = {
    text: string;
    start: number;
    end: number;
    wordStartIndex: number;
    wordEndIndex: number;
};

export type TranscriptionResponse = {
    text: string;
    words: TranscriptionWord[];
    utterances?: TranscriptionUtterance[];
    provider: TranscriptionProvider;
    model?: string;
    logId?: string | null;
};

type DoubaoWord = {
    text?: string;
    start_time?: number;
    end_time?: number;
    confidence?: number;
};

type DoubaoUtterance = {
    text?: string;
    start_time?: number;
    end_time?: number;
    words?: DoubaoWord[];
};

type WhisperWord = {
    word?: string;
    start?: number;
    end?: number;
};

type WhisperSegment = {
    text?: string;
    start?: number;
    end?: number;
};

type WhisperResponse = {
    text?: string;
    words?: WhisperWord[];
    segments?: WhisperSegment[];
};

const msToSeconds = (value: unknown): number => {
    const ms = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(ms) ? ms / 1000 : 0;
};

const isBlankText = (text: string) => text.trim().length === 0;

const findTokenStart = (chars: string[], tokenChars: string[], cursor: number): number => {
    if (tokenChars.length === 0) return cursor;

    for (let i = cursor; i <= chars.length - tokenChars.length; i += 1) {
        let matched = true;
        for (let j = 0; j < tokenChars.length; j += 1) {
            if (chars[i + j] !== tokenChars[j]) {
                matched = false;
                break;
            }
        }
        if (matched) return i;
    }

    return cursor;
};

const pushPunctuationTokens = (params: {
    chars: string[];
    anchorMs: number;
    words: TranscriptionWord[];
}) => {
    const time = msToSeconds(params.anchorMs);
    params.chars.forEach((char) => {
        if (isBlankText(char)) return;
        params.words.push({
            word: char,
            start: time,
            end: time,
            kind: 'punctuation',
        });
    });
};

const parseDoubaoUtterance = (
    utterance: DoubaoUtterance,
    words: TranscriptionWord[]
): TranscriptionUtterance | null => {
    const text = utterance.text ?? '';
    const rawWords = Array.isArray(utterance.words) ? utterance.words : [];
    const wordStartIndex = words.length;

    if (rawWords.length === 0 && text.trim()) {
        words.push({
            word: text.trim(),
            start: msToSeconds(utterance.start_time),
            end: msToSeconds(utterance.end_time),
            kind: 'speech',
        });
    } else {
        const chars = Array.from(text);
        let cursor = 0;
        let previousEndMs = utterance.start_time ?? 0;

        rawWords.forEach((rawWord) => {
            const tokenText = rawWord.text?.trim() ?? '';
            if (!tokenText) return;

            const tokenChars = Array.from(tokenText);
            const matchStart = findTokenStart(chars, tokenChars, cursor);
            if (matchStart > cursor) {
                pushPunctuationTokens({
                    chars: chars.slice(cursor, matchStart),
                    anchorMs: previousEndMs,
                    words,
                });
            }

            const startMs = rawWord.start_time ?? utterance.start_time ?? previousEndMs;
            const endMs = rawWord.end_time ?? rawWord.start_time ?? startMs;
            words.push({
                word: tokenText,
                start: msToSeconds(startMs),
                end: msToSeconds(endMs),
                kind: 'speech',
                confidence: rawWord.confidence,
            });

            previousEndMs = endMs;
            cursor = Math.max(matchStart + tokenChars.length, cursor);
        });

        if (cursor < chars.length) {
            pushPunctuationTokens({
                chars: chars.slice(cursor),
                anchorMs: previousEndMs,
                words,
            });
        }
    }

    const wordEndIndex = words.length - 1;
    if (wordEndIndex < wordStartIndex) return null;

    return {
        text,
        start: msToSeconds(utterance.start_time ?? words[wordStartIndex].start * 1000),
        end: msToSeconds(utterance.end_time ?? words[wordEndIndex].end * 1000),
        wordStartIndex,
        wordEndIndex,
    };
};

async function transcribeWithDoubao(file: File): Promise<TranscriptionResponse> {
    if (!config.doubaoApiKey) {
        throw new Error('DOUBAO_API_KEY is not set');
    }

    const audioBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const requestId = crypto.randomUUID();

    const response = await fetch(config.doubaoRecognizeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.doubaoApiKey,
            'X-Api-Resource-Id': config.doubaoResourceId,
            'X-Api-Request-Id': requestId,
            'X-Api-Sequence': '-1',
        },
        body: JSON.stringify({
            user: {
                uid: config.doubaoUid,
            },
            audio: {
                data: audioBase64,
            },
            request: {
                model_name: 'bigmodel',
                show_utterances: true,
                enable_itn: true,
                enable_punc: true,
                enable_ddc: false,
            },
        }),
    });

    const statusCode = response.headers.get('X-Api-Status-Code');
    const message = response.headers.get('X-Api-Message');
    const logId = response.headers.get('X-Tt-Logid');
    const rawText = await response.text();

    if (!response.ok || statusCode !== '20000000') {
        console.error('Doubao transcription failed', {
            httpStatus: response.status,
            statusCode,
            message,
            logId,
            bodyPreview: rawText.substring(0, 500),
        });
        throw new Error(`Doubao transcription failed: ${message || statusCode || response.status}`);
    }

    const data = rawText ? JSON.parse(rawText) : {};
    const rawUtterances: DoubaoUtterance[] = Array.isArray(data?.result?.utterances)
        ? data.result.utterances
        : [];
    const words: TranscriptionWord[] = [];
    const utterances = rawUtterances
        .map((utterance) => parseDoubaoUtterance(utterance, words))
        .filter((utterance): utterance is TranscriptionUtterance => utterance !== null);

    if (words.length === 0 && typeof data?.result?.text === 'string' && data.result.text.trim()) {
        words.push({
            word: data.result.text.trim(),
            start: 0,
            end: msToSeconds(data?.audio_info?.duration ?? data?.result?.additions?.duration),
            kind: 'speech',
        });
    }

    return {
        text: data?.result?.text || joinTranscriptTokens(words),
        words,
        utterances,
        provider: 'doubao-flash',
        model: 'bigmodel',
        logId,
    };
}

async function transcribeWithWhisper(file: File): Promise<TranscriptionResponse> {
    const key = config.uniApiKey;
    if (!key) {
        throw new Error('UNIAPI_KEY is not set');
    }

    const apiFormData = new FormData();
    apiFormData.append('file', file);
    apiFormData.append('model', 'whisper-1');
    apiFormData.append('response_format', 'verbose_json');
    apiFormData.append('timestamp_granularities[]', 'word');

    console.log('Sending audio to UniAPI Whisper-1...');

    const response = await fetch('https://api.uniapi.io/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
        },
        body: apiFormData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('UniAPI Error:', response.status, errorText);
        throw new Error(`Transcription failed: ${errorText}`);
    }

    const data = await response.json() as WhisperResponse;
    console.log('Transcription success');
    console.log('[Transcribe] Full response keys:', Object.keys(data));
    console.log('[Transcribe] text length:', data.text?.length ?? 0);
    console.log('[Transcribe] words count:', data.words?.length ?? 0);
    console.log('[Transcribe] segments count:', data.segments?.length ?? 0);

    let words: TranscriptionWord[] = data.words?.map<TranscriptionWord>((w) => ({
        word: w.word ?? '',
        start: w.start ?? 0,
        end: w.end ?? 0,
        kind: 'speech',
    })).filter((w) => w.word.length > 0) ?? [];

    if (words.length === 0 && Array.isArray(data.segments) && data.segments.length > 0) {
        console.warn('[Transcribe] No word-level timestamps — falling back to segment-level timestamps');
        words = data.segments.map<TranscriptionWord>((seg) => ({
            word: seg.text?.trim() ?? '',
            start: seg.start ?? 0,
            end: seg.end ?? 0,
            kind: 'speech',
        })).filter((w) => w.word.length > 0);
        console.log('[Transcribe] Reconstructed word count from segments:', words.length);
    }

    if (words.length === 0) {
        console.error('[Transcribe] Still 0 words after fallback. Raw data:', JSON.stringify(data).substring(0, 500));
    }

    return {
        text: data.text ?? joinTranscriptTokens(words),
        words,
        provider: 'whisper',
        model: 'whisper-1',
    };
}

export async function transcribeAudio(formData: FormData): Promise<TranscriptionResponse | null> {
    const file = formData.get('file') as File;

    if (!file) {
        console.error('No file provided for transcription');
        return null;
    }

    try {
        if (config.transcriptionProvider === 'doubao-flash') {
            return await transcribeWithDoubao(file);
        }

        return await transcribeWithWhisper(file);
    } catch (error) {
        console.error('Transcription Action Error:', error);
        throw error;
    }
}

export type TranscriptionProvider = 'whisper' | 'doubao-flash';

const parseTranscriptionProvider = (value: string | undefined): TranscriptionProvider => {
    if (value === 'doubao-flash' || value === 'whisper') return value;
    return 'whisper';
};

export const config = {
    uniApiKey: process.env.UNIAPI_KEY || '',
    transcriptionProvider: parseTranscriptionProvider(process.env.TRANSCRIPTION_PROVIDER),
    geminiSegmentationModel: process.env.GEMINI_SEGMENTATION_MODEL || 'gemini-2.5-flash',
    uniApiGeminiBaseUrl: process.env.UNIAPI_GEMINI_BASE_URL || 'https://api.uniapi.io/gemini',
    debugAiSegmentation: process.env.DEBUG_AI_SEGMENTATION === 'true',
    doubaoApiKey: process.env.DOUBAO_API_KEY || '',
    doubaoResourceId: process.env.DOUBAO_RESOURCE_ID || 'volc.bigasr.auc_turbo',
    doubaoUid: process.env.DOUBAO_UID || 'pretty-sub-local',
    doubaoRecognizeUrl: process.env.DOUBAO_RECOGNIZE_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
};

export const checkConfig = () => {
    if (config.transcriptionProvider === 'doubao-flash' && !config.doubaoApiKey) {
        console.warn('⚠️ DOUBAO_API_KEY is missing. Doubao transcription features may fail.');
        return false;
    }

    if (config.transcriptionProvider === 'whisper' && !config.uniApiKey) {
        console.warn('⚠️ UNIAPI_KEY is missing. Transcription features may fail.');
        return false;
    }

    return true;
};

export const config = {
    uniApiKey: process.env.UNIAPI_KEY || '',
    geminiSegmentationModel: process.env.GEMINI_SEGMENTATION_MODEL || 'gemini-2.5-flash',
    uniApiGeminiBaseUrl: process.env.UNIAPI_GEMINI_BASE_URL || 'https://api.uniapi.io/gemini',
};

export const checkConfig = () => {
    if (!config.uniApiKey) {
        console.warn('⚠️ UNIAPI_KEY is missing. Transcription features may fail.');
        return false;
    }
    return true;
};

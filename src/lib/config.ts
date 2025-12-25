export const config = {
    uniApiKey: process.env.UNIAPI_KEY || '',
};

export const checkConfig = () => {
    if (!config.uniApiKey) {
        console.warn('⚠️ UNIAPI_KEY is missing. Transcription features may fail.');
        return false;
    }
    return true;
};

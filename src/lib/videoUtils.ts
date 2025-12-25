export const getVideoMetadata = (file: File): Promise<{ width: number; height: number; durationInSeconds: number }> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            resolve({
                width: video.videoWidth,
                height: video.videoHeight,
                durationInSeconds: video.duration,
            });
            // We don't revoke here because we might reuse the URL if we passed a URL, 
            // but here we are creating a temp one from File. 
            // Actually, to be safe and clean, let's create a temp URL.
            URL.revokeObjectURL(video.src);
        };
        video.onerror = () => reject("Failed to load video metadata");
        video.src = URL.createObjectURL(file);
    });
};

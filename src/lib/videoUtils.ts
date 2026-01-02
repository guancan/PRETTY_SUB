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

export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

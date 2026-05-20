export type MediaKind = 'audio' | 'video';

export type MediaMetadata = {
    width: number;
    height: number;
    durationInSeconds: number;
    kind: MediaKind;
    canPreview: boolean;
};

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'webm']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv']);

export const getFileExtension = (filename: string): string => (
    filename.toLowerCase().split('.').pop() || ''
);

export const getMediaKind = (file: File): MediaKind | null => {
    const mimeType = file.type.toLowerCase();
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';

    const ext = getFileExtension(file.name);
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    return null;
};

const getHtmlMediaMetadata = (file: File, kind: MediaKind): Promise<MediaMetadata> => (
    new Promise((resolve, reject) => {
        const element = kind === 'audio'
            ? document.createElement('audio')
            : document.createElement('video');
        const url = URL.createObjectURL(file);

        element.preload = 'metadata';
        element.onloadedmetadata = () => {
            const video = element as HTMLVideoElement;
            resolve({
                width: kind === 'video' ? video.videoWidth || 1920 : 1920,
                height: kind === 'video' ? video.videoHeight || 1080 : 1080,
                durationInSeconds: Number.isFinite(element.duration) ? element.duration : 0,
                kind,
                canPreview: true,
            });
            URL.revokeObjectURL(url);
        };
        element.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Failed to load ${kind} metadata`));
        };
        element.src = url;
    })
);

export const getMediaMetadata = async (file: File): Promise<MediaMetadata> => {
    const kind = getMediaKind(file);
    if (!kind) {
        throw new Error('Unsupported media format');
    }

    try {
        return await getHtmlMediaMetadata(file, kind);
    } catch (error) {
        if (kind === 'video') {
            return {
                width: 1920,
                height: 1080,
                durationInSeconds: 0,
                kind,
                canPreview: false,
            };
        }
        throw error;
    }
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

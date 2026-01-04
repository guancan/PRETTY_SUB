interface FileSuggestion {
  show: boolean;
  type: 'success' | 'warning' | 'error';
  message: string;
}

// Translation function type
type TranslationFunction = (key: string, params?: Record<string, string | number>) => string;

export const CONFIG = {
  format: {
    recommended: ['mp4', 'webm', 'mov'],
    acceptable: ['avi', 'mkv', 'flv', 'wmv'],
  },
  fileSize: {
    recommended: 200 * 1024 * 1024,   // 200MB
    acceptable: 2 * 1024 * 1024 * 1024, // 2GB
  },
  duration: {
    recommended: 15 * 60,   // 15 minutes
    acceptable: 30 * 60,    // 30 minutes
  },
};

export const getFileExtension = (filename: string): string => {
  return filename.toLowerCase().split('.').pop() || '';
};

export const formatFileSize = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${(bytes / 1024).toFixed(1)} MB`;
  }
  return `${mb.toFixed(0)} MB`;
};

export const formatDuration = (seconds: number, t?: TranslationFunction): string => {
  const minutes = Math.floor(seconds / 60);
  if (t) {
    return `${minutes} ${t('validation.minutes')}`;
  }
  return `${minutes}分钟`;
};

/**
 * Check if file exceeds limits or needs suggestion
 */
export const getFileSuggestion = (file: File, durationSeconds: number, t: TranslationFunction): FileSuggestion => {
  const sizeMB = file.size / (1024 * 1024);
  const durationMin = Math.floor(durationSeconds / 60);
  const ext = getFileExtension(file.name);

  // Hard rejection - file size
  if (file.size > CONFIG.fileSize.acceptable) {
    return {
      show: true,
      type: 'error',
      message: t('validation.fileTooLarge', { size: formatFileSize(CONFIG.fileSize.acceptable) })
    };
  }

  // Hard rejection - duration
  if (durationSeconds > CONFIG.duration.acceptable) {
    return {
      show: true,
      type: 'error',
      message: t('validation.durationTooLong', { duration: formatDuration(CONFIG.duration.acceptable, t) })
    };
  }

  // Check for suggestions
  const issues: string[] = [];

  if (file.size > CONFIG.fileSize.recommended) {
    issues.push(t('validation.sizeRecommendation', {
      recommendedSize: formatFileSize(CONFIG.fileSize.recommended),
      currentSize: formatFileSize(file.size)
    }));
  }

  if (durationSeconds > CONFIG.duration.recommended) {
    issues.push(t('validation.durationRecommendation', {
      recommendedDuration: formatDuration(CONFIG.duration.recommended, t),
      currentDuration: durationMin
    }));
  }

  if (!CONFIG.format.recommended.includes(ext)) {
    issues.push(t('validation.formatRecommendation'));
  }

  if (issues.length > 0) {
    return {
      show: true,
      type: 'warning',
      message: t('validation.processingTimeWarning', { recommendations: issues.join(', ') })
    };
  }

  return { show: false, type: 'success', message: '' };
};

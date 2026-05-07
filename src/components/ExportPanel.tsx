'use client';

import React from 'react';
import { Download, FileText, Film, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VideoExportState } from '@/hooks/useVideoExporter';

interface ExportPanelProps {
    /** Total number of visible subtitle segments (for display) */
    segmentCount: number;
    /** Whether cuts exist in the timeline */
    hasCuts: boolean;
    /** Callback to export SRT */
    onExportSrt: () => void;
    /** Callback to export trimmed video */
    onExportVideo: () => void;
    /** Video export state from hook */
    videoExportState: VideoExportState;
    /** Reset export state */
    onResetExport: () => void;
}

const STAGE_LABELS: Record<string, { en: string; zh: string }> = {
    'loading-ffmpeg': { en: 'Loading encoder…', zh: '加载编码器…' },
    'writing-input': { en: 'Preparing video…', zh: '准备视频…' },
    'trimming': { en: 'Trimming video…', zh: '剪切视频中…' },
    'reading-output': { en: 'Packaging output…', zh: '打包输出…' },
    'done': { en: 'Export complete!', zh: '导出完成！' },
    'error': { en: 'Export failed', zh: '导出失败' },
};

export default function ExportPanel({
    segmentCount,
    hasCuts,
    onExportSrt,
    onExportVideo,
    videoExportState,
    onResetExport,
}: ExportPanelProps) {
    const { t, language } = useLanguage();
    const isExporting = !['idle', 'done', 'error'].includes(videoExportState.stage);
    const isDone = videoExportState.stage === 'done';
    const isError = videoExportState.stage === 'error';

    const stageLabel = STAGE_LABELS[videoExportState.stage]?.[language] || '';

    return (
        <div className="glass-panel" style={{ marginTop: 24, padding: 24 }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 20,
                fontSize: '1rem',
                fontWeight: 600,
            }}>
                <Download size={18} />
                {t('export.title')}
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
            }}>
                {/* SRT Export Card */}
                <button
                    onClick={onExportSrt}
                    disabled={segmentCount === 0}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 12,
                        padding: '20px 16px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        cursor: segmentCount === 0 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        opacity: segmentCount === 0 ? 0.4 : 1,
                        color: 'var(--text-primary)',
                    }}
                    onMouseEnter={e => {
                        if (segmentCount > 0) {
                            e.currentTarget.style.borderColor = '#22c55e';
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.06)';
                        }
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    }}
                >
                    <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: 'rgba(34, 197, 94, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <FileText size={24} color="#22c55e" />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
                            {t('export.srtTitle')}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {t('export.srtDescription', { count: segmentCount })}
                        </div>
                    </div>
                </button>

                {/* Video Export Card */}
                <button
                    onClick={() => {
                        if (isDone || isError) {
                            onResetExport();
                        } else if (!isExporting) {
                            onExportVideo();
                        }
                    }}
                    disabled={isExporting}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 12,
                        padding: '20px 16px',
                        background: isExporting ? 'rgba(99, 102, 241, 0.04)' : 'rgba(255, 255, 255, 0.03)',
                        border: `1px solid ${isExporting ? 'rgba(99, 102, 241, 0.3)' : (isDone ? 'rgba(34, 197, 94, 0.4)' : (isError ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-subtle)'))}`,
                        borderRadius: 'var(--radius-md)',
                        cursor: isExporting ? 'wait' : 'pointer',
                        transition: 'all 0.2s',
                        color: 'var(--text-primary)',
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                    onMouseEnter={e => {
                        if (!isExporting) {
                            e.currentTarget.style.borderColor = '#6366f1';
                            e.currentTarget.style.background = 'rgba(99, 102, 241, 0.06)';
                        }
                    }}
                    onMouseLeave={e => {
                        if (!isExporting) {
                            e.currentTarget.style.borderColor = isDone ? 'rgba(34, 197, 94, 0.4)' : (isError ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-subtle)');
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                        }
                    }}
                >
                    {/* Progress bar background */}
                    {isExporting && (
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            height: 3,
                            width: `${videoExportState.progress}%`,
                            background: 'linear-gradient(90deg, #6366f1, #818cf8)',
                            transition: 'width 0.3s ease-out',
                            borderRadius: '0 2px 0 0',
                        }} />
                    )}

                    <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: isDone
                            ? 'rgba(34, 197, 94, 0.1)'
                            : isError
                                ? 'rgba(239, 68, 68, 0.1)'
                                : 'rgba(99, 102, 241, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        {isExporting ? (
                            <Loader2 size={24} color="#6366f1" style={{ animation: 'spin 1s linear infinite' }} />
                        ) : isDone ? (
                            <CheckCircle size={24} color="#22c55e" />
                        ) : isError ? (
                            <AlertTriangle size={24} color="#ef4444" />
                        ) : (
                            <Film size={24} color="#6366f1" />
                        )}
                    </div>

                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
                            {isDone
                                ? t('export.videoDone')
                                : isError
                                    ? t('export.videoError')
                                    : t('export.videoTitle')}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {isExporting ? (
                                <span>{stageLabel} ({videoExportState.progress}%)</span>
                            ) : isDone ? (
                                t('export.clickToReset')
                            ) : isError ? (
                                <span style={{ color: '#ef4444' }}>{videoExportState.error}</span>
                            ) : hasCuts ? (
                                t('export.videoDescriptionWithCuts')
                            ) : (
                                t('export.videoDescriptionNoCuts')
                            )}
                        </div>
                    </div>
                </button>
            </div>
        </div>
    );
}

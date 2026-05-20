'use client';

import React from 'react';
import { Download, FileText, Film, Loader2, CheckCircle, AlertTriangle, Clapperboard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VideoExportState } from '@/hooks/useVideoExporter';
import { OverlayExportState } from '@/hooks/useOverlayExporter';

interface ExportPanelProps {
    /** Total number of visible subtitle segments (for display) */
    segmentCount: number;
    /** Whether cuts exist in the timeline */
    hasCuts: boolean;
    /** Callback to export SRT */
    onExportSrt: () => void;
    /** Callback to export trimmed video */
    onExportVideo: () => void;
    /** Callback to export overlay video */
    onExportOverlay: () => void;
    /** Whether source media supports video exports */
    videoExportsEnabled?: boolean;
    /** Video export state from hook */
    videoExportState: VideoExportState;
    /** Overlay export state from hook */
    overlayExportState: OverlayExportState;
    /** Reset export state */
    onResetExport: () => void;
    /** Reset overlay export state */
    onResetOverlayExport: () => void;
}

const STAGE_LABELS: Record<string, { en: string; zh: string }> = {
    'loading-ffmpeg': { en: 'Loading encoder…', zh: '加载编码器…' },
    'writing-input': { en: 'Preparing video…', zh: '准备视频…' },
    'trimming': { en: 'Trimming video…', zh: '剪切视频中…' },
    'reading-output': { en: 'Packaging output…', zh: '打包输出…' },
    'preparing': { en: 'Preparing…', zh: '准备中…' },
    'recording': { en: 'Recording frames…', zh: '录制帧中…' },
    'converting': { en: 'Converting to MP4…', zh: '转换为 MP4…' },
    'done': { en: 'Export complete!', zh: '导出完成！' },
    'error': { en: 'Export failed', zh: '导出失败' },
};

/** Reusable export card component to avoid repetition */
function ExportCard({
    onClick,
    disabled,
    isExporting,
    isDone,
    isError,
    progress,
    stageLabel,
    icon,
    iconColor,
    title,
    description,
    errorText,
    hoverColor,
    hoverBg,
}: {
    onClick: () => void;
    disabled: boolean;
    isExporting: boolean;
    isDone: boolean;
    isError: boolean;
    progress: number;
    stageLabel: string;
    icon: React.ReactNode;
    iconColor: string;
    title: string;
    description: string;
    errorText?: string;
    hoverColor: string;
    hoverBg: string;
}) {
    const { t } = useLanguage();

    return (
        <button
            onClick={onClick}
            disabled={disabled || isExporting}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                padding: '20px 16px',
                background: isExporting ? `${hoverBg}` : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${isExporting
                    ? `${hoverColor}50`
                    : isDone
                        ? 'rgba(34, 197, 94, 0.4)'
                        : isError
                            ? 'rgba(239, 68, 68, 0.4)'
                            : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                cursor: isExporting ? 'wait' : (disabled ? 'not-allowed' : 'pointer'),
                transition: 'all 0.2s',
                color: 'var(--text-primary)',
                position: 'relative',
                overflow: 'hidden',
                opacity: disabled && !isExporting ? 0.4 : 1,
            }}
            onMouseEnter={e => {
                if (!isExporting && !disabled) {
                    e.currentTarget.style.borderColor = hoverColor;
                    e.currentTarget.style.background = hoverBg;
                }
            }}
            onMouseLeave={e => {
                if (!isExporting && !disabled) {
                    e.currentTarget.style.borderColor = isDone ? 'rgba(34, 197, 94, 0.4)' : (isError ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-subtle)');
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                }
            }}
        >
            {/* Progress bar */}
            {isExporting && (
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: 3,
                    width: `${progress}%`,
                    background: `linear-gradient(90deg, ${hoverColor}, ${hoverColor}aa)`,
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
                        : `${hoverColor}18`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                {isExporting ? (
                    <Loader2 size={24} color={iconColor} style={{ animation: 'spin 1s linear infinite' }} />
                ) : isDone ? (
                    <CheckCircle size={24} color="#22c55e" />
                ) : isError ? (
                    <AlertTriangle size={24} color="#ef4444" />
                ) : (
                    icon
                )}
            </div>

            <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
                    {isDone ? t('export.videoDone') : isError ? t('export.videoError') : title}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {isExporting ? (
                        <span>{stageLabel} ({progress}%)</span>
                    ) : isDone ? (
                        t('export.clickToReset')
                    ) : isError ? (
                        <span style={{ color: '#ef4444' }}>{errorText}</span>
                    ) : (
                        description
                    )}
                </div>
            </div>
        </button>
    );
}

export default function ExportPanel({
    segmentCount,
    hasCuts,
    onExportSrt,
    onExportVideo,
    onExportOverlay,
    videoExportsEnabled = true,
    videoExportState,
    overlayExportState,
    onResetExport,
    onResetOverlayExport,
}: ExportPanelProps) {
    const { t, language } = useLanguage();

    // Video trim states
    const isVideoExporting = !['idle', 'done', 'error'].includes(videoExportState.stage);
    const isVideoDone = videoExportState.stage === 'done';
    const isVideoError = videoExportState.stage === 'error';
    const videoStageLabel = STAGE_LABELS[videoExportState.stage]?.[language] || '';

    // Overlay states
    const isOverlayExporting = !['idle', 'done', 'error'].includes(overlayExportState.stage);
    const isOverlayDone = overlayExportState.stage === 'done';
    const isOverlayError = overlayExportState.stage === 'error';
    const overlayStageLabel = STAGE_LABELS[overlayExportState.stage]?.[language] || '';

    // Disable other exports while one is running
    const anyExporting = isVideoExporting || isOverlayExporting;

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
	                gridTemplateColumns: videoExportsEnabled ? '1fr 1fr 1fr' : '1fr',
	                gap: 16,
	            }}>
                {/* SRT Export Card */}
                <ExportCard
                    onClick={onExportSrt}
                    disabled={segmentCount === 0 || anyExporting}
                    isExporting={false}
                    isDone={false}
                    isError={false}
                    progress={0}
                    stageLabel=""
                    icon={<FileText size={24} color="#22c55e" />}
                    iconColor="#22c55e"
                    title={t('export.srtTitle')}
                    description={t('export.srtDescription', { count: segmentCount })}
                    hoverColor="#22c55e"
                    hoverBg="rgba(34, 197, 94, 0.06)"
                />

	                {videoExportsEnabled && (
	                    <>
	                        {/* Trimmed Video Export Card */}
	                        <ExportCard
	                            onClick={() => {
	                                if (isVideoDone || isVideoError) {
	                                    onResetExport();
	                                } else if (!isVideoExporting) {
	                                    onExportVideo();
	                                }
	                            }}
	                            disabled={isOverlayExporting}
	                            isExporting={isVideoExporting}
	                            isDone={isVideoDone}
	                            isError={isVideoError}
	                            progress={videoExportState.progress}
	                            stageLabel={videoStageLabel}
	                            icon={<Film size={24} color="#6366f1" />}
	                            iconColor="#6366f1"
	                            title={t('export.videoTitle')}
	                            description={hasCuts ? t('export.videoDescriptionWithCuts') : t('export.videoDescriptionNoCuts')}
	                            errorText={videoExportState.error || undefined}
	                            hoverColor="#6366f1"
	                            hoverBg="rgba(99, 102, 241, 0.06)"
	                        />

	                        {/* Overlay (Burned-in Subtitles) Export Card */}
	                        <ExportCard
	                            onClick={() => {
	                                if (isOverlayDone || isOverlayError) {
	                                    onResetOverlayExport();
	                                } else if (!isOverlayExporting) {
	                                    onExportOverlay();
	                                }
	                            }}
	                            disabled={isVideoExporting}
	                            isExporting={isOverlayExporting}
	                            isDone={isOverlayDone}
	                            isError={isOverlayError}
	                            progress={overlayExportState.progress}
	                            stageLabel={overlayStageLabel}
	                            icon={<Clapperboard size={24} color="#f59e0b" />}
	                            iconColor="#f59e0b"
	                            title={t('export.overlayTitle')}
	                            description={t('export.overlayDescription')}
	                            errorText={overlayExportState.error || undefined}
	                            hoverColor="#f59e0b"
	                            hoverBg="rgba(245, 158, 11, 0.06)"
	                        />
	                    </>
	                )}
	            </div>
        </div>
    );
}

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Eye, List, Type, UploadCloud, FileAudio, FileText, ArrowUpDown } from 'lucide-react';
import { useAudioExtractor } from '@/hooks/useAudioExtractor';
import { useHistory } from '@/hooks/useHistory';
import { aiSegmentWords } from '@/actions/aiSegment';
import { transcribeAudio, TranscriptionResponse } from '@/actions/transcribe';
import { buildSegmentsFromRanges, DEFAULT_SEGMENTATION_OPTIONS, normalizeSegmentationOptions, SegmentationOptions, segmentWords, SubtitleSegment } from '@/lib/segmentation';
import SubtitleEditor from '@/components/SubtitleEditor';
import FontSelector from '@/components/FontSelector';
import SegmentationRulesModal from '@/components/SegmentationRulesModal';
import AiProcessingLoader from '@/components/AiProcessingLoader';
import ErrorDialog from '@/components/ErrorDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SegmentationStatusBadge } from '@/components/SegmentationStatus';
import { GOOGLE_FONTS, getGoogleFontUrl } from '@/lib/fonts';
import Logger from '@/lib/logger';
import { Player, PlayerRef } from '@remotion/player';
import { getVideoMetadata, formatFileSize, formatDuration } from '@/lib/videoUtils';
import { MainComposition } from '@/remotion/MainComposition';
import { calculatePlayableClips, calculateTotalDuration, mapOriginalToPlayableTime } from '@/lib/timelineUtils';

const SEGMENTATION_RULES_STORAGE_KEY = 'pretty_sub.segmentation_rules.v1';

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<{ width: number; height: number; durationInSeconds: number } | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<string>('');
  const [transcription, setTranscription] = useState<TranscriptionResponse | null>(null);
  const [segmentationOptions, setSegmentationOptions] = useState<SegmentationOptions>(DEFAULT_SEGMENTATION_OPTIONS);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'success' } | null>(null);
  const [segmentationStatus, setSegmentationStatus] = useState<'idle' | 'ai-started' | 'ai-processing' | 'ai-success' | 'ai-failed' | 'rules-processing' | 'rules-success'>('idle');
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string; clearFile?: boolean } | null>(null);
  const [showReuploadConfirm, setShowReuploadConfirm] = useState(false);

  // Use History Hook for Segments (Undo/Redo)
  const {
    state: segments,
    setState: setSegments,
    undo,
    redo,
    canUndo,
    canRedo,
    past,
    future
  } = useHistory<SubtitleSegment[]>([]);

  const [selectedFont, setSelectedFont] = useState(GOOGLE_FONTS[0].family);
  const [globalYPosition, setGlobalYPosition] = useState(80); // Default 80% from top
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'idle' | 'transcribing' | 'segmenting'>('idle');
  const [isResegmenting, setIsResegmenting] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const playerRef = useRef<PlayerRef>(null);

  const { extractAudio, isReady, load, progress } = useAudioExtractor();

  const maxChars = segmentationOptions.maxCharsPerLine ?? DEFAULT_SEGMENTATION_OPTIONS.maxCharsPerLine;
  const maxDuration = segmentationOptions.maxDurationSeconds ?? DEFAULT_SEGMENTATION_OPTIONS.maxDurationSeconds;
  const punctuationSplit = segmentationOptions.punctuationSplit ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationSplit;
  const punctuationMinChars = segmentationOptions.punctuationMinChars ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationMinChars;
  const segmentationSummary = `${maxChars}字 / ${maxDuration}s / ${punctuationSplit ? `标点>${punctuationMinChars}字` : '标点关闭'}`;

  const showToast = (message: string, tone: 'info' | 'success' = 'info') => {
    setToast({ message, tone });
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 2800);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEGMENTATION_RULES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SegmentationOptions>;
      setSegmentationOptions(normalizeSegmentationOptions(parsed));
    } catch (error) {
      Logger.warn('Failed to read segmentation rules from storage', error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SEGMENTATION_RULES_STORAGE_KEY,
        JSON.stringify(normalizeSegmentationOptions(segmentationOptions))
      );
    } catch (error) {
      Logger.warn('Failed to persist segmentation rules to storage', error);
    }
  }, [segmentationOptions]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);

      setAudioBlob(null);
      setTranscription(null);
      setSegments([]);

      try {
        setStatus('Loading metadata...');
        const meta = await getVideoMetadata(file);
        setVideoMetadata(meta);
        setStatus('Extracting audio...');

        // Auto extract audio
        await load();
        const blob = await extractAudio(file);
        if (blob) {
          setAudioBlob(blob);
          setStatus('Audio extracted. Ready to generate subtitles.');
          Logger.info('Audio blob created', { size: blob.size, type: blob.type });
        } else {
          setErrorDialog({
            title: '音频提取失败',
            message: '无法从视频中提取音频。请确保视频文件包含音频轨道，然后重试。',
            clearFile: true
          });
          setStatus('Audio extraction failed.');
        }
      } catch (err) {
        Logger.error('File processing failed', err);
        setErrorDialog({
          title: '文件处理失败',
          message: err instanceof Error ? err.message : '无法处理此视频文件。请尝试其他文件。',
          clearFile: true
        });
        setStatus('Failed to process video.');
      }
    }
  }, [load, extractAudio, setSegments]);

  // Undo/Redo Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  // Handle seeking from Editor
  const handleSeek = (originalTime: number) => {
    if (playerRef.current && videoMetadata) {
      // Map original time to playable time because we might have cuts
      const clips = calculatePlayableClips(segments, videoMetadata.durationInSeconds);
      const playableTime = mapOriginalToPlayableTime(originalTime, clips);

      const fps = 30;
      playerRef.current.seekTo(playableTime * fps);
    }
  };

  // Clear video file and all related data
  const clearVideoFile = useCallback(() => {
    setVideoFile(null);
    setVideoUrl(null);
    setVideoMetadata(null);
    setAudioBlob(null);
    setTranscription(null);
    setSegments([]);
    setStatus('');
    Logger.info('Video file and related data cleared');
  }, [setSegments]);

  const generateSegments = async (words: TranscriptionResponse['words']) => {
    try {
      setSegmentationStatus('ai-started');
      await new Promise(resolve => setTimeout(resolve, 300));
      setSegmentationStatus('ai-processing');

      const aiResult = await aiSegmentWords({
        words,
        options: segmentationOptions
      });

      if (aiResult?.ranges?.length) {
        setSegmentationStatus('ai-success');
        Logger.info('AI segmentation applied', { model: aiResult.model, ranges: aiResult.ranges.length });
        showToast(`AI 分段已应用（${aiResult.model}）`, 'success');

        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = setTimeout(() => setSegmentationStatus('idle'), 3000);

        return buildSegmentsFromRanges(words, aiResult.ranges);
      }
    } catch (error) {
      Logger.warn('AI segmentation failed, fallback to rules', error);
      setSegmentationStatus('ai-failed');
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    setSegmentationStatus('rules-processing');
    const result = segmentWords(words, segmentationOptions);
    setSegmentationStatus('rules-success');

    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setSegmentationStatus('idle'), 3000);

    return result;
  };

  const handleTranscribe = async () => {
    if (!audioBlob) return;
    setIsTranscribing(true);
    setSegments([]); // Clear segments to prevent showing editor during processing
    setProcessingStage('transcribing');
    setStatus('Transcribing audio (this may take a moment)...');

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.mp3');

      const result = await transcribeAudio(formData);
      if (result) {
        setTranscription(result);
        setProcessingStage('segmenting');
        setStatus('Generating segments...');
        const segs = await generateSegments(result.words);
        setSegments(segs);
        setStatus('Transcription & Segmentation complete!');
        Logger.info('Transcription result', result);
      }
    } catch (error) {
      setStatus(`Transcription failed: ${error}`);
      Logger.error('Transcription failed', error);
    } finally {
      setIsTranscribing(false);
      setProcessingStage('idle');
    }
  };

  const handleResegment = async () => {
    if (!transcription) return;
    const confirmed = window.confirm('重新生成分段会覆盖当前编辑内容（剪切/删除/颜色/位置）。是否继续？');
    if (!confirmed) return;
    setIsResegmenting(true);
    setStatus('Regenerating segments...');
    try {
      const segs = await generateSegments(transcription.words);
      setSegments(segs);
      setStatus('Segmentation updated.');
      setSegmentationStatus('idle');
    } finally {
      setIsResegmenting(false);
    }
  };

  return (
    <main className="container " style={{ minHeight: '100vh', flexDirection: 'column', paddingTop: 40, paddingBottom: 40, display: 'flex', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ marginBottom: 12 }}>PRETTY SUB</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
          AI-Powered Video Editor with Dynamic Subtitles
        </p>
      </div>

      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: 1200, // Wider for side-by-side
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        gap: 24
      }}>
        {/* Inject Selected Font */}
        <link rel="stylesheet" href={getGoogleFontUrl(selectedFont)} />

        {!videoFile ? (
          <label style={{
            width: '100%',
            height: 300,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer'
          }}>
            <input type="file" accept="video/*" onChange={handleFileSelect} hidden />
            <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: 24, borderRadius: '50%', marginBottom: 16 }}>
              <UploadCloud size={48} color="var(--accent-primary)" />
            </div>
            <h3 style={{ marginBottom: 8 }}>Upload Video</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Click to browse</p>
          </label>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <div className="flex-center" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{videoFile.name}</h3>
                <button
                  onClick={() => setShowReuploadConfirm(true)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    padding: '6px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-highlight)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  重新上传
                </button>
              </div>

              {/* Video Metadata Info */}
              {videoMetadata && (
                <p style={{
                  margin: '4px 0 0 0',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  fontWeight: 400
                }}>
                  {formatFileSize(videoFile.size)} • {videoMetadata.width}×{videoMetadata.height} • {formatDuration(videoMetadata.durationInSeconds)}
                </p>
              )}

              {/* Audio Extraction Status */}
              {!audioBlob && videoMetadata && (
                <div style={{
                  marginTop: 12,
                  padding: '10px 16px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <div style={{
                    width: 16,
                    height: 16,
                    border: '2px solid #f59e0b',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <span style={{ fontSize: '0.85rem', color: '#f59e0b', fontWeight: 500 }}>
                    正在提取音频...
                  </span>
                </div>
              )}
            </div>

            {/* Workflow Steps if not yet done */}
            {audioBlob && (!transcription || (transcription && (!segments || segments.length === 0))) && (
              <div style={{ display: 'flex', justifyContent: 'center', width: '60%', margin: '0 auto' }}>
                <div className={`glass-panel ${transcription ? 'completed' : ''}`} style={{ padding: 24, borderColor: transcription ? 'var(--accent-primary)' : '', width: '100%' }}>
                  <div className="flex-center" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
                    <strong style={{ fontSize: '1.1rem' }}>获取字幕</strong>
                    {transcription && <FileText size={18} color="var(--accent-primary)" />}
                  </div>

                  {!transcription || isTranscribing ? (
                    <>
                      {/* Segmentation rules config */}
                      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            分段规则：<span style={{ color: 'var(--text-primary)' }}>{segmentationSummary}</span>
                          </span>
                          <button
                            onClick={() => setIsRulesOpen(true)}
                            disabled={isTranscribing}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: isTranscribing ? 'var(--text-secondary)' : 'var(--accent-primary)',
                              cursor: isTranscribing ? 'not-allowed' : 'pointer',
                              fontSize: '0.8rem',
                              fontWeight: 500,
                              opacity: isTranscribing ? 0.5 : 1
                            }}
                          >
                            查看/编辑
                          </button>
                        </div>
                        {!isTranscribing && segmentationStatus !== 'idle' && (
                          <div style={{ marginTop: 8 }}>
                            <SegmentationStatusBadge status={segmentationStatus} />
                          </div>
                        )}
                      </div>

                      {/* Generate button */}
                      <button
                        onClick={handleTranscribe}
                        className="btn-primary"
                        disabled={!audioBlob || isTranscribing}
                        style={{
                          width: '100%',
                          minHeight: isTranscribing ? '52px' : 'auto',
                          fontSize: '1rem',
                          padding: '14px 24px',
                          background: isTranscribing ? 'rgba(99, 102, 241, 0.4)' : undefined,
                        }}
                      >
                        {isTranscribing ? (
                          <AiProcessingLoader
                            text={
                              processingStage === 'transcribing'
                                ? 'AI 处理 1/2 - 字幕获取中'
                                : 'AI 处理 2/2 - 分段优化中'
                            }
                          />
                        ) : (
                          '生成字幕'
                        )}
                      </button>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.9rem', color: '#10b981', fontWeight: 500 }}>
                      已生成 {segments.length} 个字幕片段
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Split View Editor */}
            {transcription && videoUrl && segments.length > 0 && (
              <>
                <div className="glass-panel" style={{ padding: 16, marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      分段规则：<span style={{ color: 'var(--text-primary)' }}>{segmentationSummary}</span>
                    </span>
                    <button
                      onClick={() => setIsRulesOpen(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}
                    >
                      查看/编辑
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {segmentationStatus !== 'idle' && <SegmentationStatusBadge status={segmentationStatus} />}
                    <button
                      onClick={handleResegment}
                      className="btn-primary"
                      disabled={isResegmenting}
                      style={{ padding: '6px 12px', fontSize: '0.85rem', minWidth: isResegmenting ? '120px' : 'auto' }}
                    >
                      {isResegmenting ? <AiProcessingLoader text="处理中" /> : '重新生成分段'}
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) 1fr', gap: 24, height: '70vh' }}>

                  {/* Left: Editor */}
                  <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.2)' }}>
                      <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Type size={16} /> Subtitle Editor
                      </h4>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                      <SubtitleEditor
                        segments={segments}
                        onSegmentsChange={setSegments}
                        onSeek={handleSeek}
                      />
                    </div>

                    {/* Font Selector Area */}

                  </div>

                  {/* Right: Preview */}
                  <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, background: 'black' }}>
                    <div style={{ height: '100%', width: '100%' }}>
                      <Player
                        ref={playerRef}
                        component={MainComposition}
                        inputProps={{
                          videoUrl: videoUrl,
                          segments: segments,
                          fontFamily: selectedFont,
                          videoDurationSeconds: videoMetadata?.durationInSeconds,
                          globalYPosition: globalYPosition
                        }}
                        // Calculate *visual* duration based on cuts
                        durationInFrames={(() => {
                          if (!videoMetadata) return 30 * 60;
                          const clips = calculatePlayableClips(segments, videoMetadata.durationInSeconds);
                          const totalTime = calculateTotalDuration(clips);
                          return Math.ceil(totalTime * 30);
                        })()}
                        compositionWidth={videoMetadata?.width || 1920}
                        compositionHeight={videoMetadata?.height || 1080}
                        fps={30}
                        style={{
                          width: '100%',
                          height: '100%',
                        }}
                        controls
                      />
                    </div>
                  </div>

                </div>

                {/* Bottom: Style Settings */}
                <div className="glass-panel" style={{ marginTop: 24, padding: 24 }}>
                  <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
                    {/* Font Settings */}
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: 16, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Type size={18} /> Subtitle Style
                      </div>
                      <FontSelector currentFont={selectedFont} onFontChange={setSelectedFont} />
                    </div>

                    {/* Placeholder for future settings (e.g. Size, Position) */}
                    <div style={{ width: 1, background: 'var(--border-subtle)', alignSelf: 'stretch' }} />

                    {/* Position Settings */}
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: 16, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ArrowUpDown size={18} /> Vertical Position
                      </div>
                      <div style={{ padding: '0 8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <span>Top (0%)</span>
                          <span>{globalYPosition}%</span>
                          <span>Bottom (100%)</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={globalYPosition}
                          onChange={(e) => setGlobalYPosition(Number(e.target.value))}
                          style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            background: 'rgba(20,20,20,0.92)',
            border: `1px solid ${toast.tone === 'success' ? 'rgba(34,197,94,0.6)' : 'rgba(255,255,255,0.12)'}`,
            color: 'var(--text-primary)',
            padding: '10px 14px',
            borderRadius: 12,
            boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
            fontSize: '0.85rem',
            zIndex: 3000,
          }}
        >
          {toast.message}
        </div>
      )}

      <SegmentationRulesModal
        isOpen={isRulesOpen}
        options={segmentationOptions}
        onClose={() => setIsRulesOpen(false)}
        onSave={(next) => setSegmentationOptions(next)}
      />

      <ErrorDialog
        isOpen={errorDialog !== null}
        title={errorDialog?.title || ''}
        message={errorDialog?.message || ''}
        onClose={() => {
          if (errorDialog?.clearFile) {
            clearVideoFile();
          }
          setErrorDialog(null);
        }}
      />

      <ConfirmDialog
        isOpen={showReuploadConfirm}
        title="重新上传视频"
        message="重新上传将清理当前视频及所有处理结果（字幕、编辑记录等）。此操作不可撤销。"
        confirmText="确认重新上传"
        cancelText="取消"
        onConfirm={() => {
          clearVideoFile();
          setShowReuploadConfirm(false);
        }}
        onCancel={() => setShowReuploadConfirm(false)}
      />
    </main >
  )
}

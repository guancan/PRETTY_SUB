'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Eye, List, Type, UploadCloud, FileAudio, FileText, Loader2, ArrowUpDown } from 'lucide-react';
import { useAudioExtractor } from '@/hooks/useAudioExtractor';
import { useHistory } from '@/hooks/useHistory';
import { aiSegmentWords } from '@/actions/aiSegment';
import { transcribeAudio, TranscriptionResponse } from '@/actions/transcribe';
import { buildSegmentsFromRanges, DEFAULT_SEGMENTATION_OPTIONS, normalizeSegmentationOptions, SegmentationOptions, segmentWords, SubtitleSegment } from '@/lib/segmentation';
import SubtitleEditor from '@/components/SubtitleEditor';
import FontSelector from '@/components/FontSelector';
import SegmentationRulesModal from '@/components/SegmentationRulesModal';
import { GOOGLE_FONTS, getGoogleFontUrl } from '@/lib/fonts';
import Logger from '@/lib/logger';
import { Player, PlayerRef } from '@remotion/player';
import { getVideoMetadata } from '@/lib/videoUtils';
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
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setStatus('Video loaded. Click to extract audio.');
      } catch (err) {
        console.error(err);
        setStatus('Loaded video, but failed to get metadata.');
      }

      await load();
    }
  }, [load, setSegments]);

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

  const handleExtract = async () => {
    if (!videoFile) return;
    setStatus('Extracting audio...');
    const blob = await extractAudio(videoFile);
    if (blob) {
      setAudioBlob(blob);
      setStatus('Audio extraction complete! Ready to transcribe.');
      Logger.info('Audio blob created', { size: blob.size, type: blob.type });
    } else {
      setStatus('Extraction failed.');
    }
  };

  const generateSegments = async (words: TranscriptionResponse['words']) => {
    try {
      const aiResult = await aiSegmentWords({
        words,
        options: segmentationOptions
      });

      if (aiResult?.ranges?.length) {
        Logger.info('AI segmentation applied', { model: aiResult.model, ranges: aiResult.ranges.length });
        showToast(`AI 分段已应用（${aiResult.model}）`, 'success');
        return buildSegmentsFromRanges(words, aiResult.ranges);
      }
    } catch (error) {
      Logger.warn('AI segmentation failed, fallback to rules', error);
    }

    return segmentWords(words, segmentationOptions);
  };

  const handleTranscribe = async () => {
    if (!audioBlob) return;
    setIsTranscribing(true);
    setStatus('Transcribing audio (this may take a moment)...');

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.mp3');

      const result = await transcribeAudio(formData);
      if (result) {
        setTranscription(result);
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
    }
  };

  const handleResegment = async () => {
    if (!transcription) return;
    const confirmed = window.confirm('重新生成分段会覆盖当前编辑内容（剪切/删除/颜色/位置）。是否继续？');
    if (!confirmed) return;
    setStatus('Regenerating segments...');
    const segs = await generateSegments(transcription.words);
    setSegments(segs);
    setStatus('Segmentation updated.');
  };

  return (
    <main className="container " style={{ minHeight: '100vh', flexDirection: 'column', paddingTop: 40, paddingBottom: 40, display: 'flex', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ marginBottom: 12 }}>Beautyful_Sub</h1>
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
            <div className="flex-center" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{videoFile.name}</h3>
              <button onClick={() => setVideoFile(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Change</button>
            </div>

            {/* Workflow Steps if not yet done */}
            {!transcription && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Step 1 */}
                <div className={`glass-panel ${audioBlob ? 'completed' : ''}`} style={{ padding: 16, borderColor: audioBlob ? 'var(--accent-primary)' : '' }}>
                  <div className="flex-center" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong>1. Audio Extraction</strong>
                    {audioBlob && <FileAudio size={16} color="var(--accent-primary)" />}
                  </div>
                  {!audioBlob ? (
                    <button onClick={handleExtract} className="btn-primary" disabled={!isReady} style={{ width: '100%' }}>
                      {progress > 0 && progress < 100 ? `${progress}%` : 'Extract Audio'}
                    </button>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#10b981' }}>Ready</div>
                  )}
                </div>

                {/* Step 2 */}
                <div className={`glass-panel ${transcription ? 'completed' : ''}`} style={{ padding: 16, borderColor: transcription ? 'var(--accent-primary)' : '', opacity: audioBlob ? 1 : 0.5 }}>
                  <div className="flex-center" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong>2. Segmentation</strong>
                    {transcription && <FileText size={16} color="var(--accent-primary)" />}
                  </div>
                  {!transcription ? (
                    <>
                      <button onClick={handleTranscribe} className="btn-primary" disabled={!audioBlob || isTranscribing} style={{ width: '100%' }}>
                        {isTranscribing ? 'Processing...' : 'Generate Subtitles'}
                      </button>
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>规则：{segmentationSummary}</span>
                        <button
                          onClick={() => setIsRulesOpen(true)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          查看/编辑
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#10b981' }}>{segments.length} segments</div>
                  )}
                </div>
              </div>
            )}

            {/* Split View Editor */}
            {transcription && videoUrl && (
              <>
                <div className="glass-panel" style={{ padding: 16, marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    分段规则：<span style={{ color: 'var(--text-primary)' }}>{segmentationSummary}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setIsRulesOpen(true)}
                      style={{ background: 'none', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', padding: '6px 10px', borderRadius: 8, cursor: 'pointer' }}
                    >
                      查看/编辑
                    </button>
                    <button onClick={handleResegment} className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                      重新生成分段
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
    </main >
  )
}

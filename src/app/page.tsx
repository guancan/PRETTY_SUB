'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Eye, List, Type, UploadCloud, FileAudio, FileText, Loader2 } from 'lucide-react';
import { useAudioExtractor } from '@/hooks/useAudioExtractor';
import { useHistory } from '@/hooks/useHistory';
import { transcribeAudio, TranscriptionResponse } from '@/actions/transcribe';
import { segmentWords, SubtitleSegment } from '@/lib/segmentation';
import SubtitleEditor from '@/components/SubtitleEditor';
import FontSelector from '@/components/FontSelector';
import { GOOGLE_FONTS, getGoogleFontUrl } from '@/lib/fonts';
import Logger from '@/lib/logger';
import { Player, PlayerRef } from '@remotion/player';
import { getVideoMetadata } from '@/lib/videoUtils';
import { MainComposition } from '@/remotion/MainComposition';
import { calculatePlayableClips, calculateTotalDuration, mapOriginalToPlayableTime } from '@/lib/timelineUtils';

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<{ width: number; height: number; durationInSeconds: number } | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<string>('');
  const [transcription, setTranscription] = useState<TranscriptionResponse | null>(null);

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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const playerRef = useRef<PlayerRef>(null);

  const { extractAudio, isReady, load, progress } = useAudioExtractor();

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
        const segs = segmentWords(result.words, { maxCharsPerLine: 25 });
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
                    <button onClick={handleTranscribe} className="btn-primary" disabled={!audioBlob || isTranscribing} style={{ width: '100%' }}>
                      {isTranscribing ? 'Processing...' : 'Generate Subtitles'}
                    </button>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#10b981' }}>{segments.length} segments</div>
                  )}
                </div>
              </div>
            )}

            {/* Split View Editor */}
            {transcription && videoUrl && (
              <>
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
                          videoDurationSeconds: videoMetadata?.durationInSeconds
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

                    <div style={{ flex: 1, opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 100, border: '1px dashed var(--border-subtle)', borderRadius: 8 }}>
                      <p>More visual settings coming soon...</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main >
  )
}

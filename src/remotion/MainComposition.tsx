import React from 'react';
import { AbsoluteFill, Video, Series } from 'remotion';
import { SubtitleSegment } from '@/lib/segmentation';
import { calculatePlayableClips } from '@/lib/timelineUtils';
import { DynamicCaptions } from './DynamicCaptions';

export interface MainCompositionProps {
    videoUrl: string;
    segments: SubtitleSegment[];
    fontFamily?: string;
    videoDurationSeconds?: number; // Optional but recommended for accurate cuts
    globalYPosition?: number;
}

export const MainComposition: React.FC<MainCompositionProps> = ({ videoUrl, segments, fontFamily, videoDurationSeconds, globalYPosition }) => {
    // Calculate clips on each render
    // If videoDurationSeconds is missing, default to a high number or try to estimate
    // Ideally we pass it from Page
    const duration = videoDurationSeconds || 600;
    const playableClips = calculatePlayableClips(segments, duration);

    return (
        <AbsoluteFill style={{ backgroundColor: 'black', fontFamily: fontFamily || 'sans-serif' }}>
            {/* Inject Font for the iframe composition */}
            {fontFamily && (
                <link
                    rel="stylesheet"
                    href={`https://fonts.googleapis.com/css2?family=${fontFamily.replace(/\s+/g, '+')}:wght@400;600;800&display=swap`}
                />
            )}
            {videoUrl ? (
                <Series>
                    {playableClips.map((clip, index) => (
                        <Series.Sequence
                            key={`${index}-${clip.start}`}
                            durationInFrames={Math.ceil((clip.end - clip.start) * 30)}
                        >
                            <AbsoluteFill>
                                <Video
                                    src={videoUrl}
                                    startFrom={Math.ceil(clip.start * 30)}
                                    endAt={Math.ceil(clip.end * 30)}
                                // volume={1} // Default
                                />
                                <DynamicCaptions
                                    segments={segments}
                                    fontFamily={fontFamily}
                                    globalTimeOffset={clip.start}
                                    globalYPosition={globalYPosition}
                                />
                            </AbsoluteFill>
                        </Series.Sequence>
                    ))}
                </Series>
            ) : (
                <div style={{ color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    No Video Source
                </div>
            )}
        </AbsoluteFill>
    );
};

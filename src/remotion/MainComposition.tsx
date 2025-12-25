import React from 'react';
import { AbsoluteFill, Video } from 'remotion';
import { SubtitleSegment } from '@/lib/segmentation';
import { DynamicCaptions } from './DynamicCaptions';

export interface MainCompositionProps {
    videoUrl: string;
    segments: SubtitleSegment[];
    fontFamily?: string;
}

export const MainComposition: React.FC<MainCompositionProps> = ({ videoUrl, segments, fontFamily }) => {
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
                <Video src={videoUrl} />
            ) : (
                <div style={{ color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    No Video Source
                </div>
            )}

            <DynamicCaptions segments={segments} fontFamily={fontFamily} />
        </AbsoluteFill>
    );
};

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { SubtitleSegment } from '@/lib/segmentation';

// Constants for preset colors (matching Editor)
const PRESET_COLORS = [
    'white',          // 0: Default
    '#f43f5e',        // 1: Rose
    '#22c55e',        // 2: Green
    '#3b82f6',        // 3: Blue
];

interface DynamicCaptionsProps {
    segments: SubtitleSegment[];
    fontFamily?: string;
    globalTimeOffset?: number; // Added to support time shifting
}

export const DynamicCaptions: React.FC<DynamicCaptionsProps> = ({ segments, fontFamily, globalTimeOffset = 0 }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const currentTime = (frame / fps) + globalTimeOffset;

    // Find the current segment
    // Optimization: In a long video, this simple find might be slow, but fine for prototype
    const activeSegment = segments.find(
        (seg) => currentTime >= seg.start && currentTime <= seg.end
    );

    if (!activeSegment) return null;

    return (
        <div
            style={{
                position: 'absolute',
                bottom: 100,
                left: 0,
                width: '100%',
                textAlign: 'center',
                padding: '0 40px',
                pointerEvents: 'none', // Allow clicks to pass through to video
            }}
        >
            <div
                style={{
                    display: 'inline-block', // Center the block
                    background: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(4px)',
                    padding: '16px 24px',
                    borderRadius: 16,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                }}
            >
                {activeSegment.words.map((word, index) => {
                    // Check if this word is strictly "active" based on its own timestamp?
                    // OR do we show the whole line and highlight the active word?
                    // "Karaoke" style usually highlights the active word.
                    // "Caption" style usually shows the whole line.
                    // Let's go with: Show whole line. 
                    // Colorize based on `word.color`.
                    // Handle `isDeleted` -> If deleted, do NOT render it? 
                    // If a word is deleted, maybe we should just skip rendering it in the sentence?

                    if (word.isDeleted || word.isCut) return null;

                    const isActive = currentTime >= word.start && currentTime <= word.end;

                    // If preset color is applied, use it. Else use default white.
                    // Maybe boost scale if active?

                    const color = PRESET_COLORS[word.color || 0];

                    return (
                        <span
                            key={`${activeSegment.id}-${index}`}
                            style={{
                                margin: '0 8px',
                                fontSize: 48,
                                fontFamily: fontFamily || 'system-ui, -apple-system, sans-serif',
                                fontWeight: word.color ? 800 : 600,
                                color: color,
                                textShadow: word.color ? `0 0 20px ${color}` : '0 2px 4px rgba(0,0,0,0.5)',
                                opacity: isActive ? 1 : 0.8,
                                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                                display: 'inline-block',
                                transition: 'transform 0.1s ease-out'
                            }}
                        >
                            {word.word}
                        </span>
                    );
                })}
            </div>
        </div>
    );
};

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SubtitleSegment, SegmentWord } from '@/lib/segmentation';
import { Trash2, Check, Scissors, MicOff, Palette, X } from 'lucide-react';

interface EditorProps {
    segments: SubtitleSegment[];
    onSegmentsChange: (newSegments: SubtitleSegment[]) => void;
    onSeek?: (time: number) => void;
}

type ItemType = 'word' | 'gap';

// Unified UI Item
interface UIItem {
    id: string; // Unique ID
    type: ItemType;
    text: string; // Word text or duration string
    start: number;
    end: number;
    isDeleted: boolean;
    color: number; // 0-3
    segmentId: string; // Belongs to which visual line 
    originalWordIndex?: number; // Pointer back to segment.words index
}

interface SelectionState {
    startId: string | null;
    endId: string | null;
}

const PRESET_COLORS = [
    'var(--text-primary)', // Default White
    '#f43f5e', // Rose
    '#22c55e', // Green
    '#3b82f6', // Blue
];

export default function SubtitleEditor({ segments, onSegmentsChange, onSeek }: EditorProps) {
    // We compute items from segments, but we don't duplicate state.
    // We need to find items back in segments when editing.

    const [selection, setSelection] = useState<SelectionState>({ startId: null, endId: null });
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

    // Calculate display items (Memoized purely for display)

    const items: UIItem[] = useMemo(() => {
        const newItems: UIItem[] = [];
        const MIN_GAP_DURATION = 0.1;

        segments.forEach((seg, segIdx) => {
            seg.words.forEach((word, wordIdx) => {
                let prevEnd = 0;
                if (wordIdx > 0) {
                    prevEnd = seg.words[wordIdx - 1].end;
                } else if (segIdx > 0) {
                    const prevSeg = segments[segIdx - 1];
                    if (prevSeg.words.length > 0) {
                        prevEnd = prevSeg.words[prevSeg.words.length - 1].end;
                    }
                }

                // Start Gap
                if (segIdx === 0 && wordIdx === 0 && word.start > MIN_GAP_DURATION) {
                    newItems.push({
                        id: `gap-start`,
                        type: 'gap',
                        text: `${(word.start).toFixed(2)}s`,
                        start: 0,
                        end: word.start,
                        isDeleted: false,
                        color: 0,
                        segmentId: seg.id
                    });
                }

                // Inter-word Gap
                if (wordIdx > 0 || segIdx > 0) {
                    const gap = word.start - prevEnd;
                    if (gap > MIN_GAP_DURATION) {
                        newItems.push({
                            id: `gap-${seg.id}-${wordIdx}`,
                            type: 'gap',
                            text: `${gap.toFixed(2)}s`,
                            start: prevEnd,
                            end: word.start,
                            isDeleted: false,
                            color: 0,
                            segmentId: seg.id
                        });
                    }
                }

                // Word
                newItems.push({
                    id: `${seg.id}-word-${wordIdx}`,
                    type: 'word',
                    text: word.word,
                    start: word.start,
                    end: word.end,
                    isDeleted: word.isDeleted || false,
                    color: word.color || 0,
                    segmentId: seg.id,
                    originalWordIndex: wordIdx
                });
            });
        });
        return newItems;
    }, [segments]);

    // Selection Logic
    const handleItemClick = (itemId: string, e: React.MouseEvent) => {
        // Find the item to get its start time
        const item = items.find(i => i.id === itemId);

        // Capture position for menu
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        // Center above the clicked element
        setMenuPosition({
            top: rect.top - 10, // 10px spacing above
            left: rect.left + rect.width / 2
        });

        if (e.shiftKey && selection.startId) {
            setSelection(prev => ({ ...prev, endId: itemId }));
        } else {
            setSelection({ startId: itemId, endId: itemId });
            if (item && onSeek) {
                onSeek(item.start);
            }
        }
    };

    const getSelectedIds = () => {
        if (!selection.startId || !selection.endId) return [];
        const startIndex = items.findIndex(w => w.id === selection.startId);
        const endIndex = items.findIndex(w => w.id === selection.endId);
        if (startIndex === -1 || endIndex === -1) return [];
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        return items.slice(start, end + 1).map(w => w.id);
    };
    const selectedIds = useMemo(() => getSelectedIds(), [selection, items]);

    // Hide menu if clicked outside or scroll (basic handling)
    useEffect(() => {
        const handleScroll = () => setMenuPosition(null);
        window.addEventListener('scroll', handleScroll, { capture: true });
        return () => window.removeEventListener('scroll', handleScroll, { capture: true });
    }, []);

    // Keyboard Navigation & Actions
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!selection.startId || selection.startId !== selection.endId) return; // Only single selection for now

            const selectedId = selection.startId;
            const item = items.find(i => i.id === selectedId);
            if (!item || item.type !== 'word') return;

            // Split on Enter
            if (e.key === 'Enter') {
                e.preventDefault();
                // Find segment and index
                const segIndex = segments.findIndex(s => s.id === item.segmentId);
                if (segIndex === -1) return;
                const segment = segments[segIndex];
                const wordIndex = item.originalWordIndex!; // Verified by item.type === 'word'

                // If it's the last word, nothing to split
                if (wordIndex >= segment.words.length - 1) return;

                const words1 = segment.words.slice(0, wordIndex + 1);
                const words2 = segment.words.slice(wordIndex + 1);

                const newSeg1: SubtitleSegment = {
                    ...segment,
                    words: words1,
                    end: words1[words1.length - 1].end,
                    text: words1.map(w => w.word).join(' ')
                };

                const newSeg2: SubtitleSegment = {
                    id: crypto.randomUUID(),
                    start: words2[0].start,
                    end: words2[words2.length - 1].end,
                    text: words2.map(w => w.word).join(' '),
                    words: words2
                };

                const newSegments = [...segments];
                newSegments.splice(segIndex, 1, newSeg1, newSeg2);
                onSegmentsChange(newSegments);

                // Optional: Select the first word of new segment?
                // setSelection(...)
            }

            // Merge on Backspace (if first word)
            if (e.key === 'Backspace') {
                // Check if it's the first word of the segment
                const segIndex = segments.findIndex(s => s.id === item.segmentId);
                if (segIndex <= 0) return; // Can't merge first segment or not found

                const segment = segments[segIndex];
                if (item.originalWordIndex !== 0) return; // Must be first word

                e.preventDefault();
                const prevSegment = segments[segIndex - 1];

                const mergedWords = [...prevSegment.words, ...segment.words];

                const mergedSeg: SubtitleSegment = {
                    ...prevSegment,
                    end: segment.end,
                    text: mergedWords.map(w => w.word).join(' '),
                    words: mergedWords
                };

                const newSegments = [...segments];
                newSegments.splice(segIndex - 1, 2, mergedSeg); // Remove prev and curr, insert merged
                onSegmentsChange(newSegments);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selection, items, segments, onSegmentsChange]);

    // Modify Helper
    const modifyWords = (modifier: (word: SegmentWord) => SegmentWord) => {
        const selectedItemWrappers = items.filter(i => selectedIds.includes(i.id) && i.type === 'word');

        const modificationMap = new Map<string, Set<number>>();
        selectedItemWrappers.forEach(item => {
            if (item.segmentId && item.originalWordIndex !== undefined) {
                if (!modificationMap.has(item.segmentId)) {
                    modificationMap.set(item.segmentId, new Set());
                }
                modificationMap.get(item.segmentId)!.add(item.originalWordIndex);
            }
        });

        const newSegments = segments.map(seg => {
            if (!modificationMap.has(seg.id)) return seg;

            const indicesToModify = modificationMap.get(seg.id)!;
            return {
                ...seg,
                words: seg.words.map((w, idx) => {
                    if (indicesToModify.has(idx)) {
                        return modifier(w);
                    }
                    return w;
                })
            };
        });

        onSegmentsChange(newSegments);
    };

    const deleteSelected = () => {
        modifyWords(w => ({ ...w, isDeleted: true }));
        // Optionally clear selection or keep it to allow undo immediately
    };

    const keepOnlySelected = () => {
        const newSegments = segments.map(seg => ({
            ...seg,
            words: seg.words.map((w, idx) => {
                const itemId = `${seg.id}-word-${idx}`;
                if (selectedIds.includes(itemId)) {
                    return w;
                }
                return { ...w, isDeleted: true };
            })
        }));
        onSegmentsChange(newSegments);
    };

    const restoreSelected = () => modifyWords(w => ({ ...w, isDeleted: false }));

    const setColor = (colorIndex: number) => {
        modifyWords(w => ({ ...w, color: colorIndex }));
    }

    // Clear selection
    const clearSelection = () => {
        setSelection({ startId: null, endId: null });
        setMenuPosition(null);
    };

    // Group items by segment for render
    const itemsBySegment = useMemo(() => {
        const map = new Map<string, UIItem[]>();
        segments.forEach(seg => map.set(seg.id, []));
        items.forEach(item => {
            if (map.has(item.segmentId)) map.get(item.segmentId)!.push(item);
        });
        return Array.from(map.entries());
    }, [items, segments]);

    return (
        <div className="subtitle-editor" style={{ width: '100%', userSelect: 'none', paddingBottom: 100 }}>

            {/* Floating Action Menu */}
            {selectedIds.length > 0 && menuPosition && (
                <div className="glass-panel" style={{
                    position: 'fixed',
                    top: menuPosition.top,
                    left: menuPosition.left,
                    transform: 'translate(-50%, -100%) translateY(-8px)', // Centered horizontally, pushed above, with margin
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    zIndex: 1000,
                    background: 'rgba(20, 20, 20, 0.95)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                    minWidth: 140
                }}>
                    {/* Color Row */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        {PRESET_COLORS.map((c, i) => (
                            <button
                                key={i}
                                onClick={() => setColor(i)}
                                style={{
                                    width: 20, height: 20, borderRadius: '50%', background: c,
                                    border: '2px solid rgba(255,255,255,0.2)',
                                    cursor: 'pointer',
                                    transform: 'scale(1)',
                                    transition: 'transform 0.1s',
                                    padding: 0
                                }}
                                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                                title={`Color ${i + 1}`}
                            />
                        ))}
                    </div>

                    {/* Actions Column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <button onClick={deleteSelected} className="btn-editor-action vertical delete">
                            <Trash2 size={14} /> <span>Delete</span>
                        </button>
                        <button onClick={keepOnlySelected} className="btn-editor-action vertical keep">
                            <Scissors size={14} /> <span>Keep Only</span>
                        </button>
                        <button onClick={restoreSelected} className="btn-editor-action vertical restore">
                            <Check size={14} /> <span>Restore</span>
                        </button>
                    </div>

                    <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0' }} />

                    {/* Close / Info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#555' }}>{selectedIds.length} select</span>
                        <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 2 }}>
                            <X size={12} />
                        </button>
                    </div>
                </div>
            )}

            {/* Render Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {itemsBySegment.map(([segId, segmentItems]) => {
                    if (segmentItems.length === 0) return null;
                    const startTime = segmentItems[0].start.toFixed(2);

                    return (
                        <div key={segId} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                            <div style={{
                                minWidth: 50,
                                fontSize: '0.75rem',
                                color: 'var(--text-secondary)',
                                paddingTop: 6,
                                fontFamily: 'monospace',
                                opacity: 0.7
                            }}>
                                {startTime}
                            </div>

                            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                {segmentItems.map(item => {
                                    const isSelected = selectedIds.includes(item.id);
                                    const isGap = item.type === 'gap';
                                    const color = PRESET_COLORS[item.color] || PRESET_COLORS[0];

                                    return (
                                        <span
                                            key={item.id}
                                            onClick={(e) => handleItemClick(item.id, e)}
                                            className={`editor-chip ${isGap ? 'gap-chip' : 'word-chip'} ${isSelected ? 'selected' : ''} ${item.isDeleted ? 'deleted' : ''}`}
                                            style={{
                                                padding: isGap ? '2px 6px' : '4px 8px',
                                                borderRadius: 6,
                                                cursor: 'pointer',
                                                fontSize: isGap ? '0.75rem' : '1.1rem',
                                                transition: 'all 0.15s ease-out',
                                                ...(!isGap ? {
                                                    // WORD STYLES
                                                    background: isSelected ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                    border: `1px solid ${isSelected ? 'rgba(255,255,255,0.3)' : 'transparent'}`,

                                                    // Color Logic
                                                    color: item.isDeleted ? 'var(--text-secondary)' : color,
                                                    textDecoration: item.isDeleted ? 'line-through' : 'none',
                                                    opacity: item.isDeleted ? 0.3 : 1,

                                                    // Text Shadow for colored words to make them pop
                                                    textShadow: item.color > 0 && !item.isDeleted ? `0 0 10px ${color}40` : 'none',
                                                    fontWeight: item.color > 0 ? 600 : 400
                                                } : {
                                                    // GAP STYLES
                                                    background: isSelected ? 'rgba(234, 179, 8, 0.1)' : 'transparent',
                                                    border: `1px dashed ${isSelected ? '#eab308' : 'rgba(255,255,255,0.1)'}`,
                                                    opacity: item.isDeleted ? 0.2 : 0.6,
                                                    color: isSelected ? '#eab308' : 'var(--text-secondary)',
                                                    minWidth: 24,
                                                    textAlign: 'center',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                })
                                            }}
                                            title={isGap ? `Silence: ${item.text}` : `Word: ${item.text}`}
                                        >
                                            {isGap ? (item.isDeleted ? null : <MicOff size={10} />) : null}
                                            {item.text}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            <style jsx global>{`
        .btn-editor-action {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: #a1a1aa;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.85rem;
          justify-content: flex-start;
          width: 100%;
        }
        .btn-editor-action:hover { background: rgba(255,255,255,0.05); color: white; }
        
        .btn-editor-action.delete:hover { color: #f43f5e; background: rgba(244, 63, 94, 0.1); }
        .btn-editor-action.keep:hover { color: #22c55e; background: rgba(34, 197, 94, 0.1); }
        
        .word-chip:hover {
            background: rgba(255,255,255,0.05) !important;
            transform: translateY(-1px);
        }
      `}</style>
        </div>
    );
}

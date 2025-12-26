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
    isCut?: boolean;
    isGapCut?: boolean;
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
                        isGapCut: word.isGapCut || false,
                        color: 0,
                        segmentId: seg.id,
                        originalWordIndex: 0 // Gap before start of segment is attached to word 0
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
                            isGapCut: word.isGapCut || false,
                            color: 0,
                            segmentId: seg.id,
                            originalWordIndex: wordIdx // Gap before wordIdx is attached to wordIdx
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
                    isCut: word.isCut || false,
                    isGapCut: word.isGapCut || false,
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

    // Action: Cut (Video + Text)
    const cutSelected = () => {
        // Updated logic to handle Gap Selection? 
        // Our selection logic selects Item IDs.
        // If ID is gap-{segId}-{wordIdx}, we need to find the word it belongs to.

        // Helper to mark items
        const selectedItemWrappers = items.filter(i => selectedIds.includes(i.id));
        const updates = new Map<string, Map<number, Partial<SegmentWord>>>();

        selectedItemWrappers.forEach(item => {
            if (!updates.has(item.segmentId)) updates.set(item.segmentId, new Map());
            const segUpdates = updates.get(item.segmentId)!;

            if (item.type === 'gap') {
                // Gap logic: Gap ID gap-{segId}-{wordIdx} OR gap-start
                // Wait, gap-start is gap before word 0.
                // gap-{segId}-{idx} is gap BEFORE word idx? No.
                // Line 82: `id: gap-${seg.id}-${wordIdx}`
                // Line 79: `gap = word.start - prevEnd`. It's Gap BEFORE wordIdx.
                // So if we select gap-X-Y, we set word[Y].isGapCut = true.

                // We need to parse ID or use item logic.
                // item.originalWordIndex might be undefined for gaps in current implementation?
                // Line 104 sets it for words.
                // Let's check gap generation. lines 65-90. No originalWordIndex set.
                // We should fix that in useMemo first? Or infer from ID.

                // Let's infer from ID for now to minimize refactor risk if possible, 
                // BUT adding originalWordIndex to gap items in useMemo is safer.
                // However, let's look at `item` object in `cutSelected`.
                // Actually, let's update `items` useMemo to include originalWordIndex for gaps too.
                // The gap is associated with the *following* word.

                // Let's assume we update useMemo below.
                if (item.originalWordIndex !== undefined) {
                    segUpdates.set(item.originalWordIndex, { ...segUpdates.get(item.originalWordIndex), isGapCut: true });
                }
            } else {
                // Word
                if (item.originalWordIndex !== undefined) {
                    segUpdates.set(item.originalWordIndex, { ...segUpdates.get(item.originalWordIndex), isCut: true });
                }
            }
        });

        const newSegments = segments.map(seg => {
            if (!updates.has(seg.id)) return seg;
            const segMap = updates.get(seg.id)!;
            return {
                ...seg,
                words: seg.words.map((w, idx) => {
                    if (segMap.has(idx)) {
                        return { ...w, ...segMap.get(idx) };
                    }
                    return w;
                })
            };
        });
        onSegmentsChange(newSegments);
    };

    // Action: Delete (Text only)
    const deleteSelected = () => {
        // Only affects words
        modifyWords(w => ({ ...w, isDeleted: true }));
    };

    const keepOnlySelected = () => {
        // Legacy: Keep selected, delete others.
        // User behavior: "Keep Only" usually implies "Cut everything else".
        // But user said "Delete" is text only. 
        // If I "Keep Only Selected Text", do I delete other text? Yes.
        // Do I cut other video? Maybe.
        // For now, let's keep it as "Delete Text of Others" (isDeleted=true).
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

    const restoreSelected = () => {
        // Only restores CUT state. 
        // User: "Deleted words cannot be restored" (via Restore button, probably implies Undo is fine).
        // So we only set isCut=false and isGapCut=false.
        // We do NOT touch isDeleted.

        // We need custom logic because modifyWords only targets WORDS. 
        // We need to target Gaps too.

        const selectedItemWrappers = items.filter(i => selectedIds.includes(i.id));
        const updates = new Map<string, Map<number, Partial<SegmentWord>>>();

        selectedItemWrappers.forEach(item => {
            if (!updates.has(item.segmentId)) updates.set(item.segmentId, new Map());
            const segUpdates = updates.get(item.segmentId)!;

            if (item.originalWordIndex !== undefined) {
                // Unified Restore: Clear Cut, Deleted, and GapCut
                const restoration = {
                    isDeleted: false,
                    isCut: false,
                    isGapCut: false
                };
                segUpdates.set(item.originalWordIndex, { ...segUpdates.get(item.originalWordIndex), ...restoration });
            }
        });

        const newSegments = segments.map(seg => {
            if (!updates.has(seg.id)) return seg;
            const segMap = updates.get(seg.id)!;
            return {
                ...seg,
                words: seg.words.map((w, idx) => {
                    if (segMap.has(idx)) {
                        return { ...w, ...segMap.get(idx) };
                    }
                    return w;
                })
            };
        });
        onSegmentsChange(newSegments);
    };

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
                    <button onClick={cutSelected} className="btn-editor-action vertical cut">
                        <Scissors size={14} /> <span>Cut {selectedIds.some(id => id.includes('gap')) ? '(Silence)' : '(Video)'}</span>
                    </button>
                    {!selectedIds.some(id => id.includes('gap')) && (
                        <button onClick={deleteSelected} className="btn-editor-action vertical delete">
                            <Trash2 size={14} /> <span>Delete (Text)</span>
                        </button>
                    )}
                    <button onClick={restoreSelected} className="btn-editor-action vertical restore">
                        <Check size={14} /> <span>Restore</span>
                    </button>

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
                                                    background: item.isCut ? 'rgba(244, 63, 94, 0.1)' : (isSelected ? 'rgba(255,255,255,0.1)' : 'transparent'),
                                                    border: `1px solid ${item.isCut ? 'rgba(244, 63, 94, 0.3)' : (isSelected ? 'rgba(255,255,255,0.3)' : 'transparent')}`,

                                                    // Color Logic
                                                    color: item.isCut ? '#f43f5e' : (item.isDeleted ? 'var(--text-secondary)' : color),
                                                    textDecoration: item.isDeleted || item.isCut ? 'line-through' : 'none',
                                                    opacity: item.isDeleted ? 0.3 : (item.isCut ? 0.6 : 1),

                                                    // Text Shadow
                                                    textShadow: item.color > 0 && !item.isDeleted && !item.isCut ? `0 0 10px ${color}40` : 'none',
                                                    fontWeight: item.color > 0 ? 600 : 400
                                                } : {
                                                    // GAP STYLES
                                                    background: (isGap && item.isGapCut) ? 'rgba(244, 63, 94, 0.2)' : (isSelected ? 'rgba(234, 179, 8, 0.1)' : 'transparent'),
                                                    border: `1px dashed ${(isGap && item.isGapCut) ? '#f43f5e' : (isSelected ? '#eab308' : 'rgba(255,255,255,0.1)')}`,
                                                    opacity: (isGap && item.isGapCut) ? 0.8 : 0.6,
                                                    color: (isGap && item.isGapCut) ? '#f43f5e' : (isSelected ? '#eab308' : 'var(--text-secondary)'),
                                                    minWidth: 24,
                                                    textAlign: 'center',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    textDecoration: (isGap && item.isGapCut) ? 'line-through' : 'none'
                                                })
                                            }}
                                            title={isGap ? (item.isGapCut ? "Cut Gap" : `Silence: ${item.text}`) : `Word: ${item.text}`}
                                        >
                                            {isGap ? (item.isGapCut ? <Scissors size={10} /> : <MicOff size={10} />) : null}
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
        
        .btn-editor-action.cut:hover { color: #f43f5e; background: rgba(244, 63, 94, 0.1); }
        .btn-editor-action.delete:hover { color: #a1a1aa; background: rgba(255, 255, 255, 0.1); }
        .btn-editor-action.restore:hover { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
        
        .word-chip:hover {
            background: rgba(255,255,255,0.05) !important;
            transform: translateY(-1px);
        }
      `}</style>
        </div>
    );
}

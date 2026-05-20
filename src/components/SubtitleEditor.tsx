import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SubtitleSegment, SegmentWord } from '@/lib/segmentation';
import { Trash2, Check, Scissors, MicOff, Palette, X, ArrowUpDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { isCjkText, isPunctuationText, joinTranscriptTokens } from '@/lib/transcriptText';

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
    originalWordIndices?: number[]; // Pointer back to all token indices represented by this chip
    parts?: { text: string; wordIndex: number }[];
    displayGroupId?: string;
    textEditGroupId?: string;
    textEditOriginalText?: string;
}

interface SelectionState {
    startId: string | null;
    endId: string | null;
}

interface EditingTarget {
    itemId: string;
    segmentId: string;
    indices: number[];
    text: string;
}

const PRESET_COLORS = [
    'var(--text-primary)', // Default White
    '#f43f5e', // Rose
    '#22c55e', // Green
    '#3b82f6', // Blue
];

const getItemWordIndices = (item: UIItem): number[] => (
    item.originalWordIndices ?? (item.originalWordIndex !== undefined ? [item.originalWordIndex] : [])
);

const joinOriginalWords = (words: SegmentWord[]): string => {
    const editGroupId = words[0]?.textEditGroupId;
    if (editGroupId && words.every((word) => word.textEditGroupId === editGroupId)) {
        const editOriginalText = words.find((word) => word.textEditOriginalText !== undefined)?.textEditOriginalText;
        if (editOriginalText !== undefined) return editOriginalText;
    }

    return joinTranscriptTokens(words.map((word) => ({ word: word.originalWord ?? word.word })));
};

const splitEditedTextIntoTimingUnits = (text: string): string[] => {
    const units: string[] = [];
    let bufferedText = '';

    const flushBufferedText = () => {
        if (!bufferedText) return;
        units.push(bufferedText);
        bufferedText = '';
    };

    Array.from(text).forEach((char) => {
        if (!char.trim()) {
            flushBufferedText();
            return;
        }

        if (isCjkText(char) || isPunctuationText(char)) {
            flushBufferedText();
            units.push(char);
            return;
        }

        bufferedText += char;
    });

    flushBufferedText();
    return units;
};

export default function SubtitleEditor({ segments, onSegmentsChange, onSeek }: EditorProps) {
    const { t } = useLanguage();

    // We compute items from segments, but we don't duplicate state.
    // We need to find items back in segments when editing.

    const [selection, setSelection] = useState<SelectionState>({ startId: null, endId: null });
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [expandedLayoutId, setExpandedLayoutId] = useState<string | null>(null);
    const [isDraggingSelection, setIsDraggingSelection] = useState(false);
    const [tokenOverride, setTokenOverride] = useState<{ itemId: string; wordIndex: number } | null>(null);
    const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const dragStartIdRef = useRef<string | null>(null);

    // Calculate display items (Memoized purely for display)

    const items: UIItem[] = useMemo(() => {
        const newItems: UIItem[] = [];
        const MIN_GAP_DURATION = 0.1;

        segments.forEach((seg, segIdx) => {
            const pushWordItem = (indices: number[]) => {
                if (indices.length === 0) return;

                const seenIndices = new Set<number>();
                const normalizedIndices = indices.filter((idx) => {
                    if (seenIndices.has(idx)) return false;
                    seenIndices.add(idx);
                    return true;
                });
                if (normalizedIndices.length === 0) return;

                const groupWords = normalizedIndices.map((idx) => seg.words[idx]);
                const firstWord = groupWords[0];
                const lastWord = groupWords[groupWords.length - 1];
                const firstIndex = normalizedIndices[0];
                const lastIndex = normalizedIndices[normalizedIndices.length - 1];
                const coloredWord = groupWords.find((word) => word.color && word.color > 0);

                newItems.push({
                    id: `${seg.id}-word-${firstIndex}-${lastIndex}`,
                    type: 'word',
                    text: joinTranscriptTokens(groupWords),
                    start: firstWord.start,
                    end: lastWord.end,
                    isDeleted: groupWords.every((word) => word.isDeleted),
                    isCut: groupWords.every((word) => word.isCut),
                    isGapCut: firstWord.isGapCut || false,
                    color: coloredWord?.color || 0,
                    segmentId: seg.id,
                    originalWordIndex: firstIndex,
                    originalWordIndices: normalizedIndices,
                    parts: groupWords.map((word, idx) => ({
                        text: word.word,
                        wordIndex: normalizedIndices[idx]
                    })),
                    displayGroupId: firstWord.displayGroupId,
                    textEditGroupId: firstWord.textEditGroupId,
                    textEditOriginalText: firstWord.textEditOriginalText,
                });
            };

            const pushPlainCjkRun = (indices: number[]) => {
                if (indices.length === 0) return;

                if (typeof Intl === 'undefined' || typeof Intl.Segmenter === 'undefined') {
                    indices.forEach((idx) => pushWordItem([idx]));
                    return;
                }

                const pushSegmentedCharRun = (charRunIndices: number[]) => {
                    if (charRunIndices.length === 0) return;

                    const runWords = charRunIndices.map((idx) => seg.words[idx]);
                    const runText = joinTranscriptTokens(runWords);
                    const offsets = new Map<number, number>();
                    let cursor = 0;

                    charRunIndices.forEach((idx) => {
                        offsets.set(idx, cursor);
                        cursor += Array.from(seg.words[idx].word).length;
                    });

                    const emittedGroups = new Set<string>();
                    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
                    Array.from(segmenter.segment(runText)).forEach((part) => {
                        const partStart = part.index;
                        const partEnd = part.index + Array.from(part.segment).length;
                        const groupIndices = charRunIndices.filter((idx) => {
                            const tokenStart = offsets.get(idx) ?? 0;
                            const tokenEnd = tokenStart + Array.from(seg.words[idx].word).length;
                            return tokenStart < partEnd && tokenEnd > partStart;
                        });

                        const groupKey = groupIndices.join('-');
                        if (groupIndices.length > 0 && !emittedGroups.has(groupKey)) {
                            emittedGroups.add(groupKey);
                            pushWordItem(groupIndices);
                        }
                    });
                };

                let charRunIndices: number[] = [];
                const flushCharRun = () => {
                    pushSegmentedCharRun(charRunIndices);
                    charRunIndices = [];
                };

                indices.forEach((idx) => {
                    if (Array.from(seg.words[idx].word).length === 1) {
                        charRunIndices.push(idx);
                        return;
                    }

                    flushCharRun();
                    pushWordItem([idx]);
                });

                flushCharRun();
            };

            const pushCjkRun = (indices: number[]) => {
                if (indices.length === 0) return;

                let plainRunIndices: number[] = [];
                let editRunIndices: number[] = [];
                let currentEditGroupId: string | undefined;

                const flushPlainRun = () => {
                    pushPlainCjkRun(plainRunIndices);
                    plainRunIndices = [];
                };

                const flushEditRun = () => {
                    pushWordItem(editRunIndices);
                    editRunIndices = [];
                    currentEditGroupId = undefined;
                };

                indices.forEach((idx) => {
                    const editGroupId = seg.words[idx].displayGroupId ?? seg.words[idx].textEditGroupId;
                    if (editGroupId) {
                        flushPlainRun();
                        if (currentEditGroupId && currentEditGroupId !== editGroupId) {
                            flushEditRun();
                        }
                        currentEditGroupId = editGroupId;
                        editRunIndices.push(idx);
                        return;
                    }

                    if (editRunIndices.length > 0) {
                        flushEditRun();
                    }
                    plainRunIndices.push(idx);
                });

                flushEditRun();
                flushPlainRun();
            };

            let cjkRunIndices: number[] = [];
            const flushCjkRun = () => {
                pushCjkRun(cjkRunIndices);
                cjkRunIndices = [];
            };

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

                if (!word.word) {
                    flushCjkRun();
                    return;
                }

                // Start Gap
                if (segIdx === 0 && wordIdx === 0 && word.start > MIN_GAP_DURATION) {
                    flushCjkRun();
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
                        flushCjkRun();
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

                if (word.kind !== 'punctuation' && isCjkText(word.word) && !isPunctuationText(word.word)) {
                    cjkRunIndices.push(wordIdx);
                } else {
                    flushCjkRun();
                    pushWordItem([wordIdx]);
                }
            });

            flushCjkRun();
        });
        return newItems;
    }, [segments]);

    const getTargetWordIndices = (item: UIItem): number[] => {
        const isSingleItemSelection = selection.startId === item.id && selection.endId === item.id;
        if (isSingleItemSelection && tokenOverride?.itemId === item.id) {
            return [tokenOverride.wordIndex];
        }
        return getItemWordIndices(item);
    };

    const getTextForIndices = (segmentId: string, indices: number[]) => {
        const segment = segments.find((seg) => seg.id === segmentId);
        if (!segment) return '';
        return joinTranscriptTokens(indices.map((idx) => segment.words[idx]).filter(Boolean));
    };

    const getOriginalTextForIndices = (segmentId: string, indices: number[]) => {
        const segment = segments.find((seg) => seg.id === segmentId);
        if (!segment) return '';
        return joinOriginalWords(indices.map((idx) => segment.words[idx]).filter(Boolean));
    };

    const updateWordsText = (segmentId: string, indices: number[], text: string) => {
        if (indices.length === 0) return;

        const sortedIndices = Array.from(new Set(indices)).sort((a, b) => a - b);
        const isContiguous = sortedIndices.every((idx, position) => (
            position === 0 || idx === sortedIndices[position - 1] + 1
        ));

        const newSegments = segments.map((seg) => {
            if (seg.id !== segmentId) return seg;

            const selectedWords = sortedIndices.map((idx) => seg.words[idx]).filter(Boolean);
            if (selectedWords.length === 0) return seg;

            const selectedHasCjk = selectedWords.some((word) => isCjkText(word.word));
            const replacementUnits = splitEditedTextIntoTimingUnits(text);
            const shouldReplaceRange =
                isContiguous &&
                (sortedIndices.length > 1 || (replacementUnits.length > 1 && (selectedHasCjk || isCjkText(text))));

            if (shouldReplaceRange) {
                const firstSelectedIndex = sortedIndices[0];
                const selectedCount = sortedIndices.length;
                const firstWord = selectedWords[0];
                const lastWord = selectedWords[selectedWords.length - 1];
                const editGroupId = crypto.randomUUID();
                const originalText = joinOriginalWords(selectedWords);
                const timeStart = firstWord.start;
                const timeEnd = lastWord.end;
                const duration = Math.max(0, timeEnd - timeStart);
                const units = replacementUnits.length > 0 ? replacementUnits : [''];

                const replacementWords = units.map((unit, unitIndex): SegmentWord => {
                    const sourcePosition = Math.min(
                        Math.floor(unitIndex * selectedWords.length / units.length),
                        selectedWords.length - 1
                    );
                    const sourceWord = selectedWords[sourcePosition] ?? firstWord;
                    const unitStart = units.length === 1
                        ? timeStart
                        : timeStart + (duration * unitIndex / units.length);
                    const unitEnd = unitIndex === units.length - 1
                        ? timeEnd
                        : timeStart + (duration * (unitIndex + 1) / units.length);
                    const originalWord = selectedWords[unitIndex]?.originalWord ?? selectedWords[unitIndex]?.word ?? '';

                    return {
                        ...sourceWord,
                        word: unit,
                        originalWord,
                        start: unitStart,
                        end: unitEnd,
                        kind: isPunctuationText(unit) ? 'punctuation' : 'speech',
                        displayGroupId: undefined,
                        textEditGroupId: editGroupId,
                        textEditOriginalText: originalText,
                    };
                });

                const nextWords = [...seg.words];
                nextWords.splice(firstSelectedIndex, selectedCount, ...replacementWords);

                return {
                    ...seg,
                    text: joinTranscriptTokens(nextWords),
                    words: nextWords,
                };
            }

            const nextWords = seg.words.map((word, idx) => {
                const selectedPosition = sortedIndices.indexOf(idx);
                if (selectedPosition === -1) return word;

                const originalWord = word.originalWord ?? word.word;
                return { ...word, word: text, originalWord };
            });

            return {
                ...seg,
                text: joinTranscriptTokens(nextWords),
                words: nextWords,
            };
        });

        onSegmentsChange(newSegments);
    };

    const beginTextEdit = (item: UIItem, indices: number[], e: React.MouseEvent) => {
        if (item.type !== 'word' || indices.length === 0) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenuPosition({
            top: rect.top - 10,
            left: rect.left + rect.width / 2
        });
        setSelection({ startId: item.id, endId: item.id });
        setTokenOverride(null);
        setEditingTarget({
            itemId: item.id,
            segmentId: item.segmentId,
            indices,
            text: getTextForIndices(item.segmentId, indices),
        });
        setIsDraggingSelection(false);
        dragStartIdRef.current = null;
    };

    const commitTextEdit = () => {
        if (!editingTarget) return;
        updateWordsText(editingTarget.segmentId, editingTarget.indices, editingTarget.text);
        setEditingTarget(null);
    };

    const cancelTextEdit = () => {
        setEditingTarget(null);
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
    const selectedIds = getSelectedIds();

    const activeTextInfo = (() => {
        if (selectedIds.length !== 1) return null;

        const item = items.find((candidate) => candidate.id === selectedIds[0]);
        if (!item || item.type !== 'word') return null;

        const indices = getTargetWordIndices(item);
        const currentText = getTextForIndices(item.segmentId, indices);
        const originalText = getOriginalTextForIndices(item.segmentId, indices);

        return {
            item,
            indices,
            currentText,
            originalText,
            isEdited: currentText !== originalText,
        };
    })();

    const undoTextEdit = () => {
        if (!activeTextInfo) return;
        updateWordsText(activeTextInfo.item.segmentId, activeTextInfo.indices, activeTextInfo.originalText);
        setEditingTarget(null);
    };

    // Selection Logic
    const handleItemMouseDown = (itemId: string, e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();

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
            dragStartIdRef.current = selection.startId;
        } else {
            setSelection({ startId: itemId, endId: itemId });
            dragStartIdRef.current = itemId;
            if (item && onSeek) {
                onSeek(item.start);
            }
        }
        setTokenOverride(null);
        setIsDraggingSelection(true);
    };

    const handleItemMouseEnter = (itemId: string, e: React.MouseEvent) => {
        if (!isDraggingSelection || !dragStartIdRef.current) return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenuPosition({
            top: rect.top - 10,
            left: rect.left + rect.width / 2
        });
        setTokenOverride(null);
        setSelection({ startId: dragStartIdRef.current, endId: itemId });
    };

    const handleTokenMouseDown = (item: UIItem, wordIndex: number, e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenuPosition({
            top: rect.top - 10,
            left: rect.left + rect.width / 2
        });
        setSelection({ startId: item.id, endId: item.id });
        setTokenOverride({ itemId: item.id, wordIndex });
        setIsDraggingSelection(false);
        dragStartIdRef.current = null;

        const segment = segments.find((seg) => seg.id === item.segmentId);
        const token = segment?.words[wordIndex];
        if (token && onSeek) {
            onSeek(token.start);
        }
    };

    // Hide menu if clicked outside or scroll (basic handling)
    useEffect(() => {
        const handleScroll = () => setMenuPosition(null);
        window.addEventListener('scroll', handleScroll, { capture: true });
        return () => window.removeEventListener('scroll', handleScroll, { capture: true });
    }, []);

    useEffect(() => {
        const handleMouseUp = () => {
            setIsDraggingSelection(false);
            dragStartIdRef.current = null;
        };
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, []);

    useEffect(() => {
        if (!editingTarget) return;
        editInputRef.current?.focus();
        editInputRef.current?.select();
    }, [editingTarget]);

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
                const itemWordIndices = getItemWordIndices(item);
                const wordIndex = itemWordIndices[itemWordIndices.length - 1];

                // If it's the last word, nothing to split
                if (wordIndex >= segment.words.length - 1) return;

                const words1 = segment.words.slice(0, wordIndex + 1);
                const words2 = segment.words.slice(wordIndex + 1);

                const newSeg1: SubtitleSegment = {
                    ...segment,
                    words: words1,
                    end: words1[words1.length - 1].end,
                    text: joinTranscriptTokens(words1)
                };

                const newSeg2: SubtitleSegment = {
                    id: crypto.randomUUID(),
                    start: words2[0].start,
                    end: words2[words2.length - 1].end,
                    text: joinTranscriptTokens(words2),
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
                const itemWordIndices = getItemWordIndices(item);
                if (itemWordIndices[0] !== 0) return; // Must be first word

                e.preventDefault();
                const prevSegment = segments[segIndex - 1];

                const mergedWords = [...prevSegment.words, ...segment.words];

                const mergedSeg: SubtitleSegment = {
                    ...prevSegment,
                    end: segment.end,
                    text: joinTranscriptTokens(mergedWords),
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
            const indices = getTargetWordIndices(item);
            if (item.segmentId && indices.length > 0) {
                if (!modificationMap.has(item.segmentId)) {
                    modificationMap.set(item.segmentId, new Set());
                }
                indices.forEach((idx) => modificationMap.get(item.segmentId)!.add(idx));
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

    const mergeWordPatch = (
        updates: Map<string, Map<number, Partial<SegmentWord>>>,
        segmentId: string,
        wordIndex: number,
        patch: Partial<SegmentWord>
    ) => {
        if (!updates.has(segmentId)) updates.set(segmentId, new Map());
        const segmentUpdates = updates.get(segmentId)!;
        segmentUpdates.set(wordIndex, { ...segmentUpdates.get(wordIndex), ...patch });
    };

    const addDisplaySplitPatches = (
        updates: Map<string, Map<number, Partial<SegmentWord>>>,
        item: UIItem,
        targetIndices: number[]
    ) => {
        const itemIndices = getItemWordIndices(item);
        if (targetIndices.length === 0 || targetIndices.length >= itemIndices.length) return;

        const targetSet = new Set(targetIndices);
        let currentIsTarget: boolean | null = null;
        let currentGroupId = '';

        itemIndices.forEach((idx) => {
            const isTarget = targetSet.has(idx);
            if (currentIsTarget !== isTarget) {
                currentIsTarget = isTarget;
                currentGroupId = crypto.randomUUID();
            }

            mergeWordPatch(updates, item.segmentId, idx, {
                displayGroupId: currentGroupId,
                textEditGroupId: undefined,
                textEditOriginalText: undefined,
            });
        });
    };

    const applyWordPatches = (updates: Map<string, Map<number, Partial<SegmentWord>>>) => {
        const newSegments = segments.map(seg => {
            if (!updates.has(seg.id)) return seg;
            const segmentUpdates = updates.get(seg.id)!;
            const nextWords = seg.words.map((w, idx) => (
                segmentUpdates.has(idx) ? { ...w, ...segmentUpdates.get(idx) } : w
            ));

            return {
                ...seg,
                text: joinTranscriptTokens(nextWords),
                words: nextWords
            };
        });

        onSegmentsChange(newSegments);
    };

    const applySelectedWordTokenAction = (patch: Partial<SegmentWord>) => {
        const selectedItemWrappers = items.filter(i => selectedIds.includes(i.id) && i.type === 'word');
        const updates = new Map<string, Map<number, Partial<SegmentWord>>>();

        selectedItemWrappers.forEach((item) => {
            const targetIndices = getTargetWordIndices(item);
            addDisplaySplitPatches(updates, item, targetIndices);
            targetIndices.forEach((idx) => {
                mergeWordPatch(updates, item.segmentId, idx, patch);
            });
        });

        applyWordPatches(updates);
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
                    mergeWordPatch(updates, item.segmentId, item.originalWordIndex, { isGapCut: true });
                }
            } else {
                // Word
                const targetIndices = getTargetWordIndices(item);
                addDisplaySplitPatches(updates, item, targetIndices);
                targetIndices.forEach((idx) => {
                    mergeWordPatch(updates, item.segmentId, idx, { isCut: true });
                });
            }
        });

        applyWordPatches(updates);
    };

    // Action: Delete (Text only)
    const deleteSelected = () => {
        applySelectedWordTokenAction({ isDeleted: true });
    };

    const keepOnlySelected = () => {
        // Legacy: Keep selected, delete others.
        // User behavior: "Keep Only" usually implies "Cut everything else".
        // But user said "Delete" is text only. 
        // If I "Keep Only Selected Text", do I delete other text? Yes.
        // Do I cut other video? Maybe.
        // For now, let's keep it as "Delete Text of Others" (isDeleted=true).
        const selectedBySegment = new Map<string, Set<number>>();
        items
            .filter((item) => selectedIds.includes(item.id) && item.type === 'word')
            .forEach((item) => {
                if (!selectedBySegment.has(item.segmentId)) selectedBySegment.set(item.segmentId, new Set());
                getTargetWordIndices(item).forEach((idx) => selectedBySegment.get(item.segmentId)!.add(idx));
            });

        const newSegments = segments.map(seg => ({
            ...seg,
            words: seg.words.map((w, idx) => {
                if (selectedBySegment.get(seg.id)?.has(idx)) {
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

            const indices = getTargetWordIndices(item);
            if (indices.length > 0) {
                // Unified Restore: Clear Cut, Deleted, and GapCut
                const restoration = {
                    isDeleted: false,
                    isCut: false,
                    isGapCut: false
                };
                indices.forEach((idx) => {
                    segUpdates.set(idx, { ...segUpdates.get(idx), ...restoration });
                });
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

    const updateSegmentY = (segId: string, yPos: number | undefined) => {
        const newSegments = segments.map(s => {
            if (s.id === segId) {
                return { ...s, yPosition: yPos };
            }
            return s;
        });
        onSegmentsChange(newSegments);
    };

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
                        <Scissors size={14} /> <span>{t('editor.cut')} {selectedIds.some(id => id.includes('gap')) ? t('editor.cutSilence') : t('editor.cutVideo')}</span>
                    </button>
                    {!selectedIds.some(id => id.includes('gap')) && (
                        <button onClick={deleteSelected} className="btn-editor-action vertical delete">
                            <Trash2 size={14} /> <span>{t('editor.delete')} {t('editor.deleteText')}</span>
                        </button>
                    )}
                    <button onClick={restoreSelected} className="btn-editor-action vertical restore">
                        <Check size={14} /> <span>{t('editor.restore')}</span>
                    </button>

                    {activeTextInfo && !selectedIds.some(id => id.includes('gap')) && (
                        <>
                            <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0' }} />
                            <div style={{ padding: '6px 8px', maxWidth: 220 }}>
                                <div style={{ fontSize: '0.68rem', color: '#777', marginBottom: 3 }}>原结果</div>
                                <div style={{
                                    fontSize: '0.78rem',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.4,
                                    wordBreak: 'break-word'
                                }}>
                                    {activeTextInfo.originalText || '空'}
                                </div>
                                {activeTextInfo.isEdited && (
                                    <button
                                        onClick={undoTextEdit}
                                        className="btn-editor-action vertical restore"
                                        style={{ marginTop: 6, width: '100%' }}
                                    >
                                        <Check size={14} /> <span>撤销文案编辑</span>
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0' }} />

                    {/* Close / Info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#555' }}>{t('editor.selected', { count: selectedIds.length })}</span>
                        <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 2 }}>
                            <X size={12} />
                        </button>
                    </div>
                </div>
            )}

            {/* Render Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {itemsBySegment.map(([segId, segmentItems]) => {
                    if (segmentItems.length === 0) return null;
                    const currentSegment = segments.find(s => s.id === segId);
                    const speakerName = currentSegment?.speakerName ?? currentSegment?.speakerId;
                    const speakerLabel = speakerName ? t('editor.speakerLabel', { id: speakerName }) : null;
                    const startTime = segmentItems[0].start.toFixed(2);

                    return (
                        <div key={segId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <div style={{
                                    minWidth: 50,
                                    fontSize: '0.75rem',
                                    color: 'var(--text-secondary)',
                                    paddingTop: 6,
                                    fontFamily: 'monospace',
                                    opacity: 0.7,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4
                                }}>
                                    {speakerLabel && (
                                        <span style={{
                                            alignSelf: 'flex-start',
                                            maxWidth: 62,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            border: '1px solid rgba(255,255,255,0.12)',
                                            borderRadius: 5,
                                            padding: '2px 4px',
                                            fontFamily: 'inherit',
                                            fontSize: '0.68rem',
                                            color: 'var(--accent-primary)',
                                            opacity: 0.9
                                        }}>
                                            {speakerLabel}
                                        </span>
                                    )}
                                    <span>{startTime}</span>
                                    <button
                                        onClick={() => setExpandedLayoutId(expandedLayoutId === segId ? null : segId)}
                                        title={t('editor.adjustPosition')}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: expandedLayoutId === segId ? 'var(--accent-primary)' : 'inherit',
                                            cursor: 'pointer',
                                            padding: 0,
                                            opacity: 0.6
                                        }}
                                    >
                                        <ArrowUpDown size={14} />
                                    </button>
                                </div>

                                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', columnGap: 1, rowGap: 3, alignItems: 'center' }}>
                                    {segmentItems.map(item => {
                                        const isSelected = selectedIds.includes(item.id);
                                        const isGap = item.type === 'gap';
                                        const color = PRESET_COLORS[item.color] || PRESET_COLORS[0];
                                        const isTokenOverride = tokenOverride?.itemId === item.id;
                                        const isEditing = editingTarget?.itemId === item.id;

                                        return (
                                            <span
                                                key={item.id}
                                                onMouseDown={(e) => handleItemMouseDown(item.id, e)}
                                                onMouseEnter={(e) => handleItemMouseEnter(item.id, e)}
                                                onDoubleClick={(e) => beginTextEdit(item, getItemWordIndices(item), e)}
                                                className={`editor-chip ${isGap ? 'gap-chip' : 'word-chip'} ${isSelected ? 'selected' : ''} ${item.isDeleted ? 'deleted' : ''}`}
                                                style={{
                                                    padding: isGap ? '2px 4px' : '2px 3px',
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
                                                {isEditing ? (
                                                    <input
                                                        ref={editInputRef}
                                                        value={editingTarget.text}
                                                        onChange={(e) => setEditingTarget(prev => prev ? { ...prev, text: e.target.value } : prev)}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onDoubleClick={(e) => e.stopPropagation()}
                                                        onBlur={commitTextEdit}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                commitTextEdit();
                                                            }
                                                            if (e.key === 'Escape') {
                                                                e.preventDefault();
                                                                cancelTextEdit();
                                                            }
                                                        }}
                                                        style={{
                                                            width: `${Math.max(2, editingTarget.text.length)}em`,
                                                            minWidth: 32,
                                                            maxWidth: 180,
                                                            background: 'rgba(255,255,255,0.08)',
                                                            border: '1px solid rgba(255,255,255,0.28)',
                                                            borderRadius: 4,
                                                            color: 'inherit',
                                                            font: 'inherit',
                                                            padding: '0 3px',
                                                            outline: 'none'
                                                        }}
                                                    />
                                                ) : !isGap && item.parts && item.parts.length > 1 ? (
                                                    item.parts.map((part) => {
                                                        const isTargetToken = isTokenOverride && tokenOverride?.wordIndex === part.wordIndex;
                                                        return (
                                                            <span
                                                                key={`${item.id}-${part.wordIndex}`}
                                                                onMouseDown={(e) => {
                                                                    if (isSelected) {
                                                                        handleTokenMouseDown(item, part.wordIndex, e);
                                                                    }
                                                                }}
                                                                style={{
                                                                    display: 'inline-block',
                                                                    padding: '0',
                                                                    borderRadius: 4,
                                                                    background: isTargetToken ? 'rgba(255,255,255,0.14)' : 'transparent',
                                                                    outline: isTargetToken ? '1px solid rgba(255,255,255,0.32)' : 'none'
                                                                }}
                                                            >
                                                                {part.text}
                                                            </span>
                                                        );
                                                    })
                                                ) : item.text}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Layout Slider Row */}
                            {expandedLayoutId === segId && (() => {
                                const currentY = currentSegment?.yPosition;

                                return (
                                    <div style={{ marginLeft: 66, marginBottom: 16, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                            {t('editor.yAxis')}: {currentY !== undefined ? `${currentY}%` : t('editor.default')}
                                        </span>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={currentY !== undefined ? currentY : 80} // Default 80 visual
                                            onChange={(e) => updateSegmentY(segId, Number(e.target.value))}
                                            style={{ width: 150, accentColor: 'var(--accent-primary)' }}
                                        />
                                        {currentY !== undefined && (
                                            <button
                                                onClick={() => updateSegmentY(segId, undefined)}
                                                style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border-subtle)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                                            >
                                                {t('editor.reset')}
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    );
                })}
            </div >

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
        </div >
    );
}

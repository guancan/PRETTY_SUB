import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Speaker, SubtitleSegment, SegmentWord } from '@/lib/segmentation';
import { Trash2, Check, Scissors, MicOff, X, LocateFixed, Users, Pencil, Plus, GripVertical } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { isCjkText, isPunctuationText, joinTranscriptTokens } from '@/lib/transcriptText';

interface EditorProps {
    segments: SubtitleSegment[];
    onSegmentsChange: (newSegments: SubtitleSegment[]) => void;
    speakers: Speaker[];
    onSpeakersChange: (newSpeakers: Speaker[]) => void;
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

interface SpeakerSummary {
    id: string;
    name: string;
    source: Speaker['source'];
    segmentCount: number;
    firstSegmentId?: string;
    firstStart?: number;
    colorIndex: number;
}

const PRESET_COLORS = [
    'var(--text-primary)', // Default White
    '#f43f5e', // Rose
    '#22c55e', // Green
    '#3b82f6', // Blue
];

const SPEAKER_TAG_COLORS = [
    { text: '#8b9cff', border: 'rgba(139, 156, 255, 0.38)', background: 'rgba(139, 156, 255, 0.12)' },
    { text: '#22d3ee', border: 'rgba(34, 211, 238, 0.36)', background: 'rgba(34, 211, 238, 0.11)' },
    { text: '#f59e0b', border: 'rgba(245, 158, 11, 0.38)', background: 'rgba(245, 158, 11, 0.11)' },
    { text: '#fb7185', border: 'rgba(251, 113, 133, 0.36)', background: 'rgba(251, 113, 133, 0.10)' },
    { text: '#34d399', border: 'rgba(52, 211, 153, 0.34)', background: 'rgba(52, 211, 153, 0.10)' },
];

const formatSegmentTimestamp = (seconds: number): string => {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const minutes = Math.floor(totalMs / 60000);
    const wholeSeconds = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;

    return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
};

const formatSegmentTimestampMs = (seconds: number): number => Math.max(0, Math.round(seconds * 1000));

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

export default function SubtitleEditor({ segments, onSegmentsChange, speakers, onSpeakersChange, onSeek }: EditorProps) {
    const { t } = useLanguage();

    // We compute items from segments, but we don't duplicate state.
    // We need to find items back in segments when editing.

    const [selection, setSelection] = useState<SelectionState>({ startId: null, endId: null });
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [segmentMenuId, setSegmentMenuId] = useState<string | null>(null);
    const [expandedLayoutId, setExpandedLayoutId] = useState<string | null>(null);
    const [isDraggingSelection, setIsDraggingSelection] = useState(false);
    const [tokenOverride, setTokenOverride] = useState<{ itemId: string; wordIndex: number } | null>(null);
    const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
    const [editingSpeaker, setEditingSpeaker] = useState<{ id: string; name: string } | null>(null);
    const [mergingSpeaker, setMergingSpeaker] = useState<{ fromId: string; toId: string } | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const speakerInputRef = useRef<HTMLInputElement | null>(null);
    const dragStartIdRef = useRef<string | null>(null);

    const speakerById = useMemo(() => (
        new Map(speakers.map((speaker) => [speaker.id, speaker]))
    ), [speakers]);

    const getSpeakerDisplayName = useCallback((speakerId?: string, speakerName?: string): string | null => {
        const speakerTableName = speakerId ? speakerById.get(speakerId)?.name?.trim() : null;
        if (speakerTableName) return speakerTableName;
        const trimmedName = speakerName?.trim();
        if (trimmedName) return trimmedName;
        if (!speakerId) return null;
        return t('editor.speakerLabel', { id: speakerId });
    }, [speakerById, t]);

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

    const speakerSummaries = useMemo<SpeakerSummary[]>(() => {
        const summaries: SpeakerSummary[] = [];
        const summaryById = new Map<string, SpeakerSummary>();

        speakers.forEach((speaker) => {
            const summary: SpeakerSummary = {
                id: speaker.id,
                name: speaker.name,
                source: speaker.source,
                segmentCount: 0,
                colorIndex: summaries.length % SPEAKER_TAG_COLORS.length,
            };
            summaryById.set(speaker.id, summary);
            summaries.push(summary);
        });

        segments.forEach((segment) => {
            if (!segment.speakerId) return;

            let summary = summaryById.get(segment.speakerId);
            if (!summary) {
                summary = {
                    id: segment.speakerId,
                    name: getSpeakerDisplayName(segment.speakerId, segment.speakerName) ?? segment.speakerId,
                    source: 'provider',
                    segmentCount: 0,
                    firstSegmentId: segment.id,
                    firstStart: segment.start,
                    colorIndex: summaries.length % SPEAKER_TAG_COLORS.length,
                };
                summaryById.set(segment.speakerId, summary);
                summaries.push(summary);
            }

            summary.segmentCount += 1;
            if (!summary.firstSegmentId) {
                summary.firstSegmentId = segment.id;
                summary.firstStart = segment.start;
            }
            const displayName = getSpeakerDisplayName(segment.speakerId, segment.speakerName);
            if (displayName) {
                summary.name = displayName;
            }
        });

        return summaries;
    }, [speakers, segments, getSpeakerDisplayName]);

    const speakerColorById = useMemo(() => (
        new Map(speakerSummaries.map((speaker) => [speaker.id, speaker.colorIndex]))
    ), [speakerSummaries]);

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
        setSegmentMenuId(null);
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
        setSegmentMenuId(null);
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
        setSegmentMenuId(null);
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
        setSegmentMenuId(null);
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
        const handleScroll = () => {
            setMenuPosition(null);
            setSegmentMenuId(null);
        };
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

    useEffect(() => {
        if (!editingSpeaker) return;
        speakerInputRef.current?.focus();
        speakerInputRef.current?.select();
    }, [editingSpeaker]);

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
                    ...segment,
                    id: crypto.randomUUID(),
                    start: words2[0].start,
                    end: words2[words2.length - 1].end,
                    text: joinTranscriptTokens(words2),
                    words: words2,
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

    const getSegmentItems = (segmentId: string) => items.filter((item) => item.segmentId === segmentId);

    const updateSegmentWords = (segmentId: string, patch: Partial<SegmentWord>) => {
        const newSegments = segments.map((seg) => {
            if (seg.id !== segmentId) return seg;

            const nextWords = seg.words.map((word) => ({ ...word, ...patch }));
            return {
                ...seg,
                text: joinTranscriptTokens(nextWords),
                words: nextWords,
            };
        });

        onSegmentsChange(newSegments);
        setSegmentMenuId(null);
        setMenuPosition(null);
    };

    const patchSegmentFromItems = (segmentId: string, patchForItem: (item: UIItem) => Partial<SegmentWord> | null) => {
        const updates = new Map<string, Map<number, Partial<SegmentWord>>>();

        getSegmentItems(segmentId).forEach((item) => {
            const patch = patchForItem(item);
            if (!patch) return;

            getItemWordIndices(item).forEach((idx) => {
                mergeWordPatch(updates, segmentId, idx, patch);
            });
        });

        applyWordPatches(updates);
        setSegmentMenuId(null);
        setMenuPosition(null);
    };

    const cutSegment = (segmentId: string) => {
        patchSegmentFromItems(segmentId, (item) => (
            item.type === 'gap'
                ? { isGapCut: true }
                : { isCut: true }
        ));
    };

    const deleteSegmentText = (segmentId: string) => {
        updateSegmentWords(segmentId, { isDeleted: true });
    };

    const restoreSegment = (segmentId: string) => {
        updateSegmentWords(segmentId, {
            isCut: false,
            isDeleted: false,
            isGapCut: false,
        });
    };

    const setSegmentColor = (segmentId: string, colorIndex: number) => {
        updateSegmentWords(segmentId, { color: colorIndex });
    };

    const toggleSegmentLayout = (segmentId: string) => {
        setExpandedLayoutId((currentId) => (currentId === segmentId ? null : segmentId));
        setSegmentMenuId(null);
        setMenuPosition(null);
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
        setSegmentMenuId(null);
    };

    const focusSpeaker = (speaker: SpeakerSummary) => {
        if (!speaker.firstSegmentId || speaker.firstStart === undefined) return;

        onSeek?.(speaker.firstStart);
        setMenuPosition(null);
        setSegmentMenuId(null);
        setExpandedLayoutId(null);

        const firstItem = items.find((item) => item.segmentId === speaker.firstSegmentId && item.type === 'word');
        if (firstItem) {
            setSelection({ startId: firstItem.id, endId: firstItem.id });
        }

        window.requestAnimationFrame(() => {
            document
                .querySelector(`[data-segment-id="${speaker.firstSegmentId}"]`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
    };

    const beginRenameSpeaker = (speaker: SpeakerSummary) => {
        setEditingSpeaker({ id: speaker.id, name: speaker.name });
        setMenuPosition(null);
        setSegmentMenuId(null);
        setMergingSpeaker(null);
    };

    const commitSpeakerRename = () => {
        if (!editingSpeaker) return;

        const nextName = editingSpeaker.name.trim();
        const fallbackName = getSpeakerDisplayName(editingSpeaker.id) || editingSpeaker.id;
        const resolvedName = nextName || fallbackName;
        const hasExistingSpeaker = speakers.some((speaker) => speaker.id === editingSpeaker.id);
        onSpeakersChange(
            hasExistingSpeaker
                ? speakers.map((speaker) => (
                    speaker.id === editingSpeaker.id
                        ? { ...speaker, name: resolvedName }
                        : speaker
                ))
                : [...speakers, { id: editingSpeaker.id, name: resolvedName, source: 'provider' }]
        );
        const newSegments = segments.map((segment) => (
            segment.speakerId === editingSpeaker.id
                ? { ...segment, speakerName: resolvedName }
                : segment
        ));

        onSegmentsChange(newSegments);
        setEditingSpeaker(null);
    };

    const cancelSpeakerRename = () => {
        setEditingSpeaker(null);
    };

    const createSpeaker = () => {
        const id = `manual-${crypto.randomUUID()}`;
        const name = t('editor.newSpeakerName', { count: speakerSummaries.length + 1 });
        onSpeakersChange([...speakers, { id, name, source: 'manual' }]);
        setEditingSpeaker({ id, name });
        setMergingSpeaker(null);
        setSegmentMenuId(null);
        setMenuPosition(null);
    };

    const assignSegmentSpeaker = (segmentId: string, speakerId: string) => {
        const speaker = speakerSummaries.find((candidate) => candidate.id === speakerId);
        if (!speaker) return;

        const newSegments = segments.map((segment) => (
            segment.id === segmentId
                ? { ...segment, speakerId: speaker.id, speakerName: speaker.name }
                : segment
        ));

        onSegmentsChange(newSegments);
    };

    const beginMergeSpeaker = (speaker: SpeakerSummary) => {
        if (speaker.segmentCount === 0) {
            onSpeakersChange(speakers.filter((candidate) => candidate.id !== speaker.id));
            return;
        }

        const target = speakerSummaries.find((candidate) => candidate.id !== speaker.id);
        if (!target) return;

        setMergingSpeaker({ fromId: speaker.id, toId: target.id });
        setEditingSpeaker(null);
        setSegmentMenuId(null);
        setMenuPosition(null);
    };

    const commitSpeakerMerge = () => {
        if (!mergingSpeaker) return;

        const target = speakerSummaries.find((speaker) => speaker.id === mergingSpeaker.toId);
        if (!target) return;

        const newSegments = segments.map((segment) => (
            segment.speakerId === mergingSpeaker.fromId
                ? { ...segment, speakerId: target.id, speakerName: target.name }
                : segment
        ));

        onSpeakersChange(speakers.filter((speaker) => speaker.id !== mergingSpeaker.fromId));
        onSegmentsChange(newSegments);
        setMergingSpeaker(null);
    };

    const cancelSpeakerMerge = () => {
        setMergingSpeaker(null);
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
            {selectedIds.length > 0 && menuPosition && !segmentMenuId && (
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

            {speakerSummaries.length > 0 && (
                <div
                    className="glass-panel"
                    style={{
                        marginBottom: 14,
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                        background: 'rgba(255,255,255,0.035)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 8,
                    }}
                >
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        marginRight: 2,
                    }}>
                        <Users size={14} />
                        <span>{t('editor.speakers')}</span>
                        <span style={{ opacity: 0.7 }}>{t('editor.speakerCount', { count: speakerSummaries.length })}</span>
                        <button
                            onClick={createSpeaker}
                            title={t('editor.speakerCreate')}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 22,
                                height: 22,
                                marginLeft: 2,
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 5,
                                background: 'rgba(255,255,255,0.04)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                padding: 0,
                            }}
                        >
                            <Plus size={13} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {speakerSummaries.map((speaker) => {
                            const tone = SPEAKER_TAG_COLORS[speaker.colorIndex];
                            const isRenamingSpeaker = editingSpeaker?.id === speaker.id;
                            const isMergingSpeaker = mergingSpeaker?.fromId === speaker.id;
                            const mergeTargets = speakerSummaries.filter((candidate) => candidate.id !== speaker.id);
                            const canMergeOrDelete = speaker.segmentCount === 0 || mergeTargets.length > 0;
                            return (
                                <div
                                    key={speaker.id}
                                    title={t('editor.speakerSeekTitle', { name: speaker.name })}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        maxWidth: isRenamingSpeaker || isMergingSpeaker ? 320 : 270,
                                        minHeight: 28,
                                        border: `1px solid ${tone.border}`,
                                        borderRadius: 6,
                                        padding: '3px 5px',
                                        background: tone.background,
                                        color: tone.text,
                                        fontSize: '0.76rem',
                                        lineHeight: 1.25,
                                    }}
                                >
                                    {isMergingSpeaker ? (
                                        <>
                                            <span style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: '50%',
                                                background: tone.text,
                                                flex: '0 0 auto',
                                                marginLeft: 3,
                                            }} />
                                            <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                {t('editor.speakerMergeInto')}
                                            </span>
                                            <select
                                                value={mergingSpeaker.toId}
                                                onChange={(event) => setMergingSpeaker({ fromId: speaker.id, toId: event.target.value })}
                                                style={{
                                                    minWidth: 92,
                                                    maxWidth: 150,
                                                    border: `1px solid ${tone.border}`,
                                                    borderRadius: 4,
                                                    background: 'rgba(0,0,0,0.18)',
                                                    color: 'inherit',
                                                    font: 'inherit',
                                                    padding: '2px 4px',
                                                    outline: 'none',
                                                }}
                                            >
                                                {mergeTargets.map((target) => (
                                                    <option key={target.id} value={target.id}>
                                                        {target.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <span style={{
                                                color: 'var(--text-secondary)',
                                                opacity: 0.78,
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {t('editor.speakerSegmentCount', { count: speaker.segmentCount })}
                                            </span>
                                        </>
                                    ) : isRenamingSpeaker ? (
                                        <>
                                            <span style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: '50%',
                                                background: tone.text,
                                                flex: '0 0 auto',
                                                marginLeft: 3,
                                            }} />
                                            <input
                                                ref={speakerInputRef}
                                                value={editingSpeaker.name}
                                                onChange={(event) => setEditingSpeaker({ id: speaker.id, name: event.target.value })}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        commitSpeakerRename();
                                                    }
                                                    if (event.key === 'Escape') {
                                                        event.preventDefault();
                                                        cancelSpeakerRename();
                                                    }
                                                }}
                                                aria-label={t('editor.speakerNamePlaceholder')}
                                                style={{
                                                    width: `${Math.max(5, editingSpeaker.name.length)}em`,
                                                    minWidth: 64,
                                                    maxWidth: 140,
                                                    border: `1px solid ${tone.border}`,
                                                    borderRadius: 4,
                                                    background: 'rgba(0,0,0,0.18)',
                                                    color: 'inherit',
                                                    font: 'inherit',
                                                    padding: '2px 4px',
                                                    outline: 'none',
                                                }}
                                            />
                                            <span style={{
                                                color: 'var(--text-secondary)',
                                                opacity: 0.78,
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {t('editor.speakerSegmentCount', { count: speaker.segmentCount })}
                                            </span>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => focusSpeaker(speaker)}
                                            title={t('editor.speakerSeekTitle', { name: speaker.name })}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                minHeight: 22,
                                                minWidth: 0,
                                                border: 'none',
                                                background: 'transparent',
                                                color: 'inherit',
                                                cursor: 'pointer',
                                                padding: '1px 3px',
                                            }}
                                        >
                                            <span style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: '50%',
                                                background: tone.text,
                                                flex: '0 0 auto',
                                            }} />
                                            <span style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {speaker.name}
                                            </span>
                                            <span style={{
                                                color: 'var(--text-secondary)',
                                                opacity: 0.78,
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {t('editor.speakerSegmentCount', { count: speaker.segmentCount })}
                                            </span>
                                            <LocateFixed size={12} style={{ flex: '0 0 auto', opacity: 0.8 }} />
                                        </button>
                                    )}
                                    {isRenamingSpeaker ? (
                                        <>
                                            <button
                                                onClick={commitSpeakerRename}
                                                title={t('editor.speakerRenameSave')}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    height: 22,
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    background: 'rgba(255,255,255,0.10)',
                                                    color: 'inherit',
                                                    cursor: 'pointer',
                                                    padding: 0,
                                                }}
                                            >
                                                <Check size={13} />
                                            </button>
                                            <button
                                                onClick={cancelSpeakerRename}
                                                title={t('editor.speakerRenameCancel')}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    height: 22,
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    background: 'transparent',
                                                    color: 'var(--text-secondary)',
                                                    cursor: 'pointer',
                                                    padding: 0,
                                                }}
                                            >
                                                <X size={13} />
                                            </button>
                                            <button
                                                onClick={() => beginMergeSpeaker(speaker)}
                                                disabled={!canMergeOrDelete}
                                                title={
                                                    speaker.segmentCount === 0
                                                        ? t('editor.speakerDeleteEmpty', { name: speaker.name })
                                                        : t('editor.speakerMergeTitle', { name: speaker.name })
                                                }
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    height: 22,
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    background: 'transparent',
                                                    color: canMergeOrDelete ? 'inherit' : 'var(--text-secondary)',
                                                    cursor: canMergeOrDelete ? 'pointer' : 'not-allowed',
                                                    padding: 0,
                                                    opacity: canMergeOrDelete ? 0.8 : 0.35,
                                                }}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </>
                                    ) : isMergingSpeaker ? (
                                        <>
                                            <button
                                                onClick={commitSpeakerMerge}
                                                title={t('editor.speakerMergeSave')}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    height: 22,
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    background: 'rgba(255,255,255,0.10)',
                                                    color: 'inherit',
                                                    cursor: 'pointer',
                                                    padding: 0,
                                                }}
                                            >
                                                <Check size={13} />
                                            </button>
                                            <button
                                                onClick={cancelSpeakerMerge}
                                                title={t('editor.speakerMergeCancel')}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    height: 22,
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    background: 'transparent',
                                                    color: 'var(--text-secondary)',
                                                    cursor: 'pointer',
                                                    padding: 0,
                                                }}
                                            >
                                                <X size={13} />
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => beginRenameSpeaker(speaker)}
                                            title={t('editor.speakerRenameTitle', { name: speaker.name })}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: 22,
                                                height: 22,
                                                border: 'none',
                                                borderRadius: 4,
                                                background: 'transparent',
                                                color: 'inherit',
                                                cursor: 'pointer',
                                                padding: 0,
                                                opacity: 0.8,
                                            }}
                                        >
                                            <Pencil size={12} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Render Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {itemsBySegment.map(([segId, segmentItems]) => {
                    if (segmentItems.length === 0) return null;
                    const currentSegment = segments.find(s => s.id === segId);
                    const speakerLabel = getSpeakerDisplayName(currentSegment?.speakerId, currentSegment?.speakerName);
                    const speakerTone = currentSegment?.speakerId
                        ? SPEAKER_TAG_COLORS[speakerColorById.get(currentSegment.speakerId) ?? 0]
                        : null;
                    const startTime = formatSegmentTimestamp(segmentItems[0].start);
                    const startTimeMs = formatSegmentTimestampMs(segmentItems[0].start);

                    return (
                        <div key={segId} data-segment-id={segId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <div style={{
                                    flex: '0 0 126px',
                                    width: 126,
                                    fontSize: '0.75rem',
                                    color: 'var(--text-secondary)',
                                    paddingTop: 4,
                                    fontFamily: 'monospace',
                                    display: 'grid',
                                    gridTemplateColumns: '24px minmax(0, 1fr)',
                                    columnGap: 6,
                                    alignItems: 'start',
                                    position: 'relative'
                                }}>
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setSegmentMenuId(segmentMenuId === segId ? null : segId);
                                            setMenuPosition(null);
                                        }}
                                        title={t('editor.segmentMenu')}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 24,
                                            height: 24,
                                            border: `1px solid ${segmentMenuId === segId || expandedLayoutId === segId ? 'rgba(139, 156, 255, 0.42)' : 'rgba(255,255,255,0.10)'}`,
                                            borderRadius: 5,
                                            background: segmentMenuId === segId || expandedLayoutId === segId ? 'rgba(139, 156, 255, 0.12)' : 'rgba(255,255,255,0.03)',
                                            color: segmentMenuId === segId || expandedLayoutId === segId ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            padding: 0,
                                            opacity: 0.9
                                        }}
                                    >
                                        <GripVertical size={14} />
                                    </button>

                                    {segmentMenuId === segId && (
                                        <div
                                            className="glass-panel"
                                            style={{
                                                position: 'absolute',
                                                top: 28,
                                                left: 0,
                                                zIndex: 1000,
                                                width: 224,
                                                padding: 6,
                                                border: '1px solid rgba(255,255,255,0.1)',
                                                borderRadius: 12,
                                                background: 'rgba(20, 20, 20, 0.95)',
                                                backdropFilter: 'blur(16px)',
                                                boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 4,
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                {PRESET_COLORS.map((color, colorIndex) => (
                                                    <button
                                                        key={colorIndex}
                                                        onClick={() => setSegmentColor(segId, colorIndex)}
                                                        style={{
                                                            width: 20,
                                                            height: 20,
                                                            borderRadius: '50%',
                                                            background: color,
                                                            border: '2px solid rgba(255,255,255,0.2)',
                                                            cursor: 'pointer',
                                                            transform: 'scale(1)',
                                                            transition: 'transform 0.1s',
                                                            padding: 0
                                                        }}
                                                        onMouseEnter={event => event.currentTarget.style.transform = 'scale(1.2)'}
                                                        onMouseLeave={event => event.currentTarget.style.transform = 'scale(1)'}
                                                        title={`Color ${colorIndex + 1}`}
                                                    />
                                                ))}
                                            </div>
                                            <button
                                                onClick={() => cutSegment(segId)}
                                                className="btn-editor-action vertical cut"
                                            >
                                                <Scissors size={14} />
                                                <span>{t('editor.segmentCutVideo')}</span>
                                            </button>
                                            <button
                                                onClick={() => deleteSegmentText(segId)}
                                                className="btn-editor-action vertical delete"
                                            >
                                                <Trash2 size={14} />
                                                <span>{t('editor.segmentDeleteText')}</span>
                                            </button>
                                            <button
                                                onClick={() => restoreSegment(segId)}
                                                className="btn-editor-action vertical restore"
                                            >
                                                <Check size={14} />
                                                <span>{t('editor.restore')}</span>
                                            </button>
                                            <button
                                                onClick={() => toggleSegmentLayout(segId)}
                                                className="btn-editor-action vertical"
                                            >
                                                <LocateFixed size={14} />
                                                <span>{t('editor.segmentAdjustPosition')}</span>
                                            </button>
                                            <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0' }} />
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
                                                <span style={{ fontSize: '0.7rem', color: '#555' }}>{t('editor.segmentSelected', { count: 1 })}</span>
                                                <button
                                                    onClick={() => setSegmentMenuId(null)}
                                                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 2 }}
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{
                                        display: 'flex',
                                        minWidth: 0,
                                        flexDirection: 'column',
                                        gap: 3
                                    }}>
                                        {speakerSummaries.length > 0 && currentSegment ? (
                                            <select
                                                value={currentSegment.speakerId ?? ''}
                                                onChange={(event) => assignSegmentSpeaker(currentSegment.id, event.target.value)}
                                                title={t('editor.segmentSpeakerSelect')}
                                                style={{
                                                    alignSelf: 'flex-start',
                                                    width: '100%',
                                                    maxWidth: 94,
                                                    border: `1px solid ${speakerTone?.border ?? 'rgba(255,255,255,0.12)'}`,
                                                    borderRadius: 5,
                                                    padding: '1px 4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: '0.67rem',
                                                    lineHeight: 1.25,
                                                    color: speakerTone?.text ?? 'var(--accent-primary)',
                                                    background: speakerTone?.background ?? 'rgba(255,255,255,0.04)',
                                                    outline: 'none',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {!currentSegment.speakerId && (
                                                    <option value="" disabled>
                                                        {t('editor.speakerSelectPlaceholder')}
                                                    </option>
                                                )}
                                                {speakerSummaries.map((speaker) => (
                                                    <option key={speaker.id} value={speaker.id}>
                                                        {speaker.name}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : speakerLabel && (
                                            <span style={{
                                                alignSelf: 'flex-start',
                                                maxWidth: 94,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                border: `1px solid ${speakerTone?.border ?? 'rgba(255,255,255,0.12)'}`,
                                                borderRadius: 5,
                                                padding: '1px 5px',
                                                fontFamily: 'inherit',
                                                fontSize: '0.67rem',
                                                lineHeight: 1.25,
                                                color: speakerTone?.text ?? 'var(--accent-primary)',
                                                background: speakerTone?.background ?? 'transparent',
                                                opacity: 1
                                            }}>
                                                {speakerLabel}
                                            </span>
                                        )}
                                        <span
                                            title={t('editor.timestampTitle', { time: startTime, milliseconds: startTimeMs })}
                                            style={{ opacity: 0.68, fontSize: '0.7rem', lineHeight: 1.1 }}
                                        >
                                            {startTime}
                                        </span>
                                    </div>
                                </div>

                                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', columnGap: 0, rowGap: 2, alignItems: 'center' }}>
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
                                                    padding: isGap ? '1px 3px' : '1px 2px',
                                                    borderRadius: 5,
                                                    cursor: 'pointer',
                                                    fontSize: isGap ? '0.7rem' : '1rem',
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
                                    <div style={{ marginLeft: 134, marginBottom: 10, padding: '7px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 10 }}>
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

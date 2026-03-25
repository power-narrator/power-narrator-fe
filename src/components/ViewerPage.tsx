import { Box, Group, Button, Image, ScrollArea, Textarea, Title, ActionIcon, Tooltip, Menu, rem, TextInput, Text, Select, Slider, Loader } from '@mantine/core';
import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import {
    IconPlayerPause,
    IconPlayerPlay,
    IconKeyboard,
    IconVolume,
    IconPilcrow,
    IconChevronDown,
    IconClock,
    IconPlus,
    IconArrowBackUp,
    IconArrowForwardUp,
    IconSettings,
    IconDeviceTv,
    IconRefresh
} from '@tabler/icons-react';
import type { Slide } from '../electron';
import { generateAudio, getAudioBuffer } from '../utils/tts';
import { SettingsModal } from './SettingsModal';
import { useSettings } from '../context/useSettings';
import { DEFAULT_SPEAKER_KEY, DEFAULT_SPEAKER_LABEL, DEFAULT_SPEAKER_VALUE } from '../constants/speakers';
import { getErrorMessage } from '../utils/errors';
import { formatNotes, parseNotes, type NoteSection } from '../utils/notes';
import type { Voice } from '../types/voice';

type IpcRendererLike = {
    invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
};

interface BasicIpcResult {
    success: boolean;
    error?: string;
}

interface SlidesIpcResult extends BasicIpcResult {
    slides?: Slide[];
}

interface VideoIpcResult extends BasicIpcResult {
    outputPath?: string;
}

const SectionPreviewButtons = ({ section, mappings, onFocus, getTextarea }: { section: NoteSection, mappings: Record<string, Voice>, onFocus: () => void, getTextarea?: () => HTMLTextAreaElement | null }) => {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [activePreviewTarget, setActivePreviewTarget] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const isSeekingRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isAudioGenerating, setIsAudioGenerating] = useState(false);
    const shouldAutoplayRef = useRef(false);

    const speakers = [{ value: DEFAULT_SPEAKER_VALUE, label: DEFAULT_SPEAKER_LABEL }].concat(
        Object.keys(mappings).filter((key) => key !== DEFAULT_SPEAKER_KEY).map((key) => ({ value: key, label: key }))
    );

    const handlePlay = async (speakerValue: string) => {
        const targetSpeaker = speakerValue || section.speaker;

        if (activePreviewTarget === speakerValue) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            shouldAutoplayRef.current = false;
            setActivePreviewTarget(null);
            return;
        }

        let textToPlay = section.text;
        if (getTextarea) {
            const ta = getTextarea();
            if (ta && ta.selectionStart !== ta.selectionEnd) {
                textToPlay = ta.value.substring(ta.selectionStart, ta.selectionEnd);
            }
        }
        if (!textToPlay) {
            alert("No text to preview.");
            return;
        }

        onFocus();
        try {
            setIsAudioGenerating(true);
            setActivePreviewTarget(speakerValue);
            shouldAutoplayRef.current = true;
            const voiceOverride = targetSpeaker ? mappings[targetSpeaker] : undefined;
            const url = await generateAudio(textToPlay, voiceOverride);
            setCurrentTime(0);
            setDuration(0);
            setAudioUrl(url);
        } catch (error: unknown) {
            alert("Failed to play audio: " + getErrorMessage(error));
            shouldAutoplayRef.current = false;
            setActivePreviewTarget(null);
        } finally {
            setIsAudioGenerating(false);
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <Box px="xs" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <audio
                ref={audioRef}
                src={audioUrl || ''}
                onCanPlay={() => {
                    if (!shouldAutoplayRef.current || !audioRef.current) {
                        return;
                    }

                    shouldAutoplayRef.current = false;
                    audioRef.current.currentTime = 0;
                    audioRef.current.play().catch((error) => {
                        console.error(error);
                        setActivePreviewTarget(null);
                    });
                }}
                onTimeUpdate={() => { if (audioRef.current && !isSeekingRef.current) setCurrentTime(audioRef.current.currentTime); }}
                onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
                onEnded={() => setActivePreviewTarget(null)}
            />
            
            <Group gap="xs" mb="xs">
                {speakers.map(spk => {
                    const isActive = activePreviewTarget === spk.value;
                    const isGenerating = isAudioGenerating && isActive;
                    return (
                        <Button
                            key={spk.value}
                            size="compact-sm"
                            variant="outline"
                            color="blue"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handlePlay(spk.value)}
                            loading={isGenerating}
                            disabled={isAudioGenerating && !isGenerating}
                            leftSection={isActive ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                        >
                            {spk.label}
                        </Button>
                    );
                })}
            </Group>

            <Group gap="xs">
                <ActionIcon
                    variant="filled"
                    color={activePreviewTarget === section.speaker ? "red" : "blue"}
                    size="sm"
                    radius="xl"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePlay(DEFAULT_SPEAKER_VALUE)}
                    disabled={!section.text || (isAudioGenerating && activePreviewTarget !== section.speaker)}
                >
                    {activePreviewTarget === section.speaker && !isAudioGenerating ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                </ActionIcon>
                <Box style={{ flex: 1, position: 'relative' }}>
                    {isAudioGenerating && activePreviewTarget === section.speaker ? (
                        <div style={{ height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader size="xs" variant="dots" color="blue" />
                        </div>
                    ) : (
                        <Group gap="xs" wrap="nowrap">
                            <Slider
                                style={{ flex: 1 }}
                                size="sm"
                                value={currentTime}
                                min={0}
                                max={duration || 100}
                                onChange={(v) => { isSeekingRef.current = true; setCurrentTime(v); }}
                                onChangeEnd={(v) => {
                                    isSeekingRef.current = false;
                                    if (audioRef.current) audioRef.current.currentTime = v;
                                }}
                                label={formatTime}
                                disabled={!audioUrl}
                            />
                            <Text size="10px" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </Text>
                        </Group>
                    )}
                </Box>
            </Group>
        </Box>
    );
};

interface ViewerPageProps {
    slides: Slide[];
    filePath: string;
    onBack: () => void;
}

export function ViewerPage({ slides: initialSlides, filePath, onBack }: ViewerPageProps) {
    const [slides, setSlides] = useState<Slide[]>(initialSlides);
    const [history, setHistory] = useState<Slide[][]>([initialSlides]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activeSlideIndex, setActiveSlideIndex] = useState(0);
    const [activeSectionIndex, setActiveSectionIndex] = useState(0);
    const textareasRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
    const [customBreak, setCustomBreak] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSelectionRef = useRef<{ sectionIndex: number; start: number; end: number } | null>(null);
    const { mappings, xmlCliEnabled } = useSettings();
    const electronWindow = window as Window & { require?: (moduleName: string) => { ipcRenderer?: IpcRendererLike } };
    const ipcRenderer = typeof electronWindow.require === 'function'
        ? (electronWindow.require('electron').ipcRenderer ?? null)
        : null;
    const activeSlide = slides[activeSlideIndex] || { src: '', notes: '' };

    function replaceSlides(nextSlides: Slide[]) {
        setSlides(nextSlides);
        return nextSlides;
    }

    function updateActiveSlideSections(updater: (sections: NoteSection[]) => void) {
        const sections = parseNotes(activeSlide.notes || '');
        updater(sections);
        const nextSlides = [...slides];
        nextSlides[activeSlideIndex] = { ...nextSlides[activeSlideIndex], notes: formatNotes(sections) };
        return replaceSlides(nextSlides);
    }

    const [isSyncing, setIsSyncing] = useState(false);

    useEffect(() => {
        setSlides(initialSlides);
        setHistory([initialSlides]);
        setHistoryIndex(0);
        setActiveSlideIndex(0);
        setActiveSectionIndex(0);
    }, [initialSlides]);

    useEffect(() => {
        setActiveSectionIndex(0);
    }, [activeSlideIndex]);

    // Push current state to history. 
    // If 'overwrite', replaces the current history head (useful for typing sequences).
    // Usually we push new state.
    function pushToHistory(newSlides: Slide[]) {
        setHistory(prev => {
            const currentHistory = prev.slice(0, historyIndex + 1);
            return [...currentHistory, newSlides];
        });
        setHistoryIndex(prev => prev + 1);
    }

    function insertWrappedTag(startTag: string, endTag: string = '') {
        const textarea = textareasRefs.current[activeSectionIndex];
        if (!textarea) {
            return;
        }

        const selectionStart = textarea.selectionStart;
        const selectionEnd = textarea.selectionEnd;
        const nextSlides = updateActiveSlideSections((sections) => {
            const activeSection = sections[activeSectionIndex];
            if (!activeSection) {
                return;
            }

            const text = activeSection.text || '';
            const before = text.substring(0, selectionStart);
            const selection = text.substring(selectionStart, selectionEnd);
            const after = text.substring(selectionEnd);
            activeSection.text = before + startTag + selection + endTag + after;
        });

        pendingSelectionRef.current = {
            sectionIndex: activeSectionIndex,
            start: selectionStart + startTag.length,
            end: selectionEnd + startTag.length,
        };

        pushToHistory(nextSlides);
    }

    function insertSelfClosingTag(tag: string) {
        insertWrappedTag(tag);
    }

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            setHistoryIndex(prev => prev - 1);
            setSlides(history[historyIndex - 1]);
        }
    }, [historyIndex, history, setSlides]);

    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(prev => prev + 1);
            setSlides(history[historyIndex + 1]);
        }
    }, [historyIndex, history, setSlides]);


    // Keyboard Shortcuts for Undo/Redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                handleUndo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                handleRedo();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleRedo, handleUndo, history, historyIndex]);

    useLayoutEffect(() => {
        const pendingSelection = pendingSelectionRef.current;
        if (!pendingSelection || pendingSelection.sectionIndex !== activeSectionIndex) {
            return;
        }

        const textarea = textareasRefs.current[pendingSelection.sectionIndex];
        if (!textarea) {
            return;
        }

        textarea.focus();
        textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
        pendingSelectionRef.current = null;
    }, [activeSlide.notes, activeSectionIndex]);


    const handleSectionTextChange = (index: number, value: string) => {
        const newSlides = updateActiveSlideSections((sections) => {
            if (!sections[index]) {
                return;
            }

            sections[index].text = value;
        });

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            pushToHistory(newSlides);
        }, 800);
    };

    const handleSpeakerChange = (index: number, speaker: string | null) => {
        const newSlides = updateActiveSlideSections((sections) => {
            if (!sections[index]) {
                return;
            }

            sections[index].speaker = speaker || '';
        });
        pushToHistory(newSlides);
    };

    const handleAddSection = () => {
        const newSectionIndex = parseNotes(activeSlide.notes || '').length;
        const newSlides = updateActiveSlideSections((sections) => {
            sections.push({ speaker: '', text: '' });
        });
        pushToHistory(newSlides);
        setActiveSectionIndex(newSectionIndex);
    };

    const handleDeleteSection = (index: number) => {
        const nextSectionCount = Math.max(0, parseNotes(activeSlide.notes || '').length - 1);
        const newSlides = updateActiveSlideSections((sections) => {
            sections.splice(index, 1);
        });
        pushToHistory(newSlides);
        if (activeSectionIndex >= nextSectionCount) {
            setActiveSectionIndex(Math.max(0, nextSectionCount - 1));
        }
    };

    const handleCustomBreak = () => {
        if (!customBreak) return;
        insertSelfClosingTag(`<break time="${customBreak}"/>`);
        setCustomBreak('');
    };

    const [splitRatio, setSplitRatio] = useState(40); // Percentage height of top panel
    const splitContainerRef = useRef<HTMLDivElement>(null);

    const handleResizeMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startSplit = splitRatio;
        const containerHeight = splitContainerRef.current?.clientHeight || 1;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const deltaPercentage = (deltaY / containerHeight) * 100;
            const newSplit = Math.min(Math.max(startSplit + deltaPercentage, 20), 80); // Clamp between 20% and 80%
            setSplitRatio(newSplit);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    // Video Generation State
    const [isGenerating, setIsGenerating] = useState(false);
    const [genStatus, setGenStatus] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');
    const [isInsertingAudio, setIsInsertingAudio] = useState(false);
    const [insertStatus, setInsertStatus] = useState('');
    const [isRemoving, setIsRemoving] = useState(false);
    const [removeStatus, setRemoveStatus] = useState('');
    const busy = isGenerating || isSaving || isSyncing || isInsertingAudio || isRemoving;

    async function buildSlideAudioEntries(slidesToProcess: Slide[], onProgress?: (message: string) => void) {
        const audioEntries: Array<{ index: number; sectionIndex: number; audioData: Uint8Array }> = [];

        for (const slide of slidesToProcess) {
            if (!slide.notes?.trim()) {
                continue;
            }

            onProgress?.(`Generating audio for slide ${slide.index}...`);
            const sections = parseNotes(slide.notes);

            for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
                const section = sections[sectionIndex];
                if (!section.text.trim()) {
                    continue;
                }

                const buffer = await getAudioBuffer(section.text, mappings[section.speaker] || undefined);
                audioEntries.push({
                    index: slide.index,
                    sectionIndex,
                    audioData: new Uint8Array(buffer),
                });
            }
        }

        return audioEntries;
    }

    async function saveNotesToFile(slidesToSave: Slide[]) {
        const result = await availableIpcRenderer.invoke<BasicIpcResult>('save-all-notes', filePath, slidesToSave);
        if (!result.success) {
            throw new Error(result.error || 'Save failed');
        }

        return result;
    }

    function resetHistoryWithSlides(nextSlides: Slide[]) {
        setSlides(nextSlides);
        setHistory([nextSlides]);
        setHistoryIndex(0);
    }

    async function runRemoveAudio(scope: 'slide' | 'all') {
        const slideIndex = activeSlide.index || (activeSlideIndex + 1);
        return availableIpcRenderer.invoke<BasicIpcResult>('remove-audio', {
            filePath,
            scope,
            slideIndex,
        });
    }

    const handleGenerateVideo = async () => {
        if (isGenerating) return;

        try {
            setGenStatus('Saving notes...');
            await saveNotesToFile(slides);

            const savePath = await availableIpcRenderer.invoke<string | null>('get-video-save-path');
            if (!savePath) {
                return;
            }

            setIsGenerating(true);
            setGenStatus('Preparing audio...');

            const slidesAudio = [];
            for (const slide of slides) {
                if (!slide.notes?.trim()) {
                    continue;
                }

                setGenStatus(`Generating audio for slide ${slide.index}...`);
                const buffer = await getAudioBuffer(slide.notes, undefined);
                slidesAudio.push({
                    index: slide.index,
                    audioData: new Uint8Array(buffer),
                });
            }

            setGenStatus('Rendering video (this may take a while)...');
            const result = await availableIpcRenderer.invoke<VideoIpcResult>('generate-video', {
                filePath,
                slidesAudio,
                videoOutputPath: savePath,
            });

            if (result.success) {
                alert('Video generated successfully at: ' + result.outputPath);
            } else {
                alert('Video generation failed: ' + result.error);
            }

        } catch (error: unknown) {
            console.error("Error preparing video generation:", error);
            alert("Error preparing generation: " + getErrorMessage(error));
        } finally {
            setIsGenerating(false);
            setGenStatus('');
        }
    };

    const handleSaveAllNotes = async () => {
        if (isSaving || isInsertingAudio) return;
        setIsSaving(true);
        setSaveStatus('Saving all notes...');

        try {
            await saveNotesToFile(slides);
            alert('Notes saved successfully!');
        } catch (error: unknown) {
            console.error("Save failed:", error);
            alert("Save error: " + getErrorMessage(error));
        } finally {
            setIsSaving(false);
            if (saveStatus !== 'Saved!') setSaveStatus('');
        }
    };

    const handleSaveCurrentSlideNotes = async () => {
        if (isSaving || isInsertingAudio) return;
        setIsSaving(true);
        setSaveStatus(`Saving Note for Slide ${activeSlide.index}...`);

        try {
            await saveNotesToFile([activeSlide]);
            setSaveStatus('Saved!');
            setTimeout(() => setSaveStatus(''), 2000);
        } catch (error: unknown) {
            console.error("Save slide failed:", error);
            alert("Save error: " + getErrorMessage(error));
        } finally {
            setIsSaving(false);
            if (saveStatus !== 'Saved!') setSaveStatus('');
        }
    };

    const handleInsertSlideAudio = async () => {
        if (isInsertingAudio || isSaving || isGenerating || isSyncing) return;
        setIsInsertingAudio(true);
        setInsertStatus(`Generating audio for slide ${activeSlide.index}...`);

        try {
            const slidesAudio = await buildSlideAudioEntries([activeSlide], setInsertStatus);

            if (slidesAudio.length === 0) {
                alert("No notes found to generate audio.");
                setIsInsertingAudio(false);
                return;
            }

            setInsertStatus('Inserting audio...');
            const result = await availableIpcRenderer.invoke<BasicIpcResult>('insert-audio', filePath, slidesAudio);

            if (result.success) {
                setInsertStatus('Audio Inserted!');
                setTimeout(() => setInsertStatus(''), 2000);
            } else {
                alert('Failed to insert audio: ' + result.error);
            }
        } catch (error: unknown) {
            console.error("Insert audio failed:", error);
            alert("Insert error: " + getErrorMessage(error));
        } finally {
            setIsInsertingAudio(false);
            if (insertStatus !== 'Audio Inserted!') setInsertStatus('');
        }
    };

    const handleInsertAllAudio = async () => {
        if (isInsertingAudio || isSaving || isGenerating || isSyncing) return;
        setIsInsertingAudio(true);
        setInsertStatus('Generating audio for all slides...');

        try {
            const slidesAudio = await buildSlideAudioEntries(slides, setInsertStatus);

            if (slidesAudio.length === 0) {
                alert("No notes found to generate audio.");
                setIsInsertingAudio(false);
                return;
            }

            setInsertStatus('Inserting all audio...');
            const result = await availableIpcRenderer.invoke<BasicIpcResult>('insert-audio', filePath, slidesAudio);

            if (result.success) {
                alert('All audio inserted successfully!');
            } else {
                alert('Failed to insert audio: ' + result.error);
            }
        } catch (error: unknown) {
            console.error("Insert all audio failed:", error);
            alert("Insert error: " + getErrorMessage(error));
        } finally {
            setIsInsertingAudio(false);
            setInsertStatus('');
        }
    };

    const handlePlaySlide = async () => {
        try {
            const indexToPlay = activeSlide.index || (activeSlideIndex + 1);
            const result = await availableIpcRenderer.invoke<BasicIpcResult>('play-slide', indexToPlay);
            if (!result.success) {
                alert('Failed to play slide: ' + result.error);
            }
        } catch (error: unknown) {
            console.error("Play slide error:", error);
            alert("Play slide error: " + getErrorMessage(error));
        }
    };

    const handleSyncAll = async () => {
        if (isSyncing || isSaving || isGenerating) return;

        if (!window.confirm("Syncing will override any unsaved changes in your notes. Do you want to proceed?")) {
            return;
        }

        setIsSyncing(true);

        try {
            const result = await availableIpcRenderer.invoke<SlidesIpcResult>('convert-pptx', filePath);

            if (result.success && result.slides) {
                resetHistoryWithSlides(result.slides);

                if (activeSlideIndex >= result.slides.length) {
                    setActiveSlideIndex(Math.max(0, result.slides.length - 1));
                }
            } else {
                alert('Sync failed: ' + (result.error || 'Unknown error'));
            }
        } catch (error: unknown) {
            console.error("Sync error:", error);
            alert("Sync error: " + getErrorMessage(error));
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSyncSlide = async () => {
        if (isSyncing || isSaving || isGenerating) return;

        if (!window.confirm("Syncing will override any unsaved changes in your notes. Do you want to proceed?")) {
            return;
        }

        setIsSyncing(true);

        try {
            const indexToSync = activeSlide.index || (activeSlideIndex + 1);
            const result = await availableIpcRenderer.invoke<SlidesIpcResult>('sync-slide', {
                filePath,
                slideIndex: indexToSync
            });

            if (result.success && result.slides) {
                resetHistoryWithSlides(result.slides);
            } else {
                alert('Sync Slide failed: ' + (result.error || 'Unknown error'));
            }
        } catch (error: unknown) {
            console.error("Sync slide error:", error);
            alert("Sync slide error: " + getErrorMessage(error));
        } finally {
            setIsSyncing(false);
        }
    };

    const handleRemoveSlideAudio = async () => {
        if (isGenerating || isSaving || isSyncing || isRemoving) return;
        setIsRemoving(true);
        setRemoveStatus('Removing audio...');
        try {
            const result = await runRemoveAudio('slide');

            if (result.success) {
                setRemoveStatus('Removed!');
                setTimeout(() => setRemoveStatus(''), 2000);
            } else {
                alert('Failed to remove audio: ' + (result.error || 'Unknown error'));
            }
        } catch (error: unknown) {
            console.error("Remove audio error:", error);
            alert("Remove audio error: " + getErrorMessage(error));
        } finally {
            setIsRemoving(false);
            if (removeStatus !== 'Removed!') setRemoveStatus('');
        }
    };

    const handleRemoveAllAudio = async () => {
        if (isGenerating || isSaving || isSyncing || isRemoving) return;
        setIsRemoving(true);
        setRemoveStatus('Removing all audio...');
        try {
            const result = await runRemoveAudio('all');

            if (result.success) {
                alert('Successfully removed audio from all slides.');
            } else {
                alert('Failed to remove audio: ' + (result.error || 'Unknown error'));
            }
        } catch (error: unknown) {
            console.error("Remove all audio error:", error);
            alert("Remove audio error: " + getErrorMessage(error));
        } finally {
            setIsRemoving(false);
            setRemoveStatus('');
        }
    };

    if (!ipcRenderer) {
        return (
            <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
                <Group justify="space-between" p="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)', background: 'var(--mantine-color-dark-7)' }}>
                    <Button variant="subtle" size="xs" onClick={onBack}>&larr; Back</Button>
                    <Title order={5}>Viewer</Title>
                    <div />
                </Group>
                <Box p="xl">
                    <Text c="red" fw={600} mb="sm">Electron IPC is unavailable.</Text>
                    <Text size="sm" c="dimmed">Please run this app inside the Electron desktop shell to use viewer actions.</Text>
                </Box>
            </div>
        );
    }

    const availableIpcRenderer = ipcRenderer;

    return (
        <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header / Toolbar */}
            <Group justify="space-between" p="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)', background: 'var(--mantine-color-dark-7)' }}>
                <Group>
                    <Button variant="subtle" size="xs" onClick={onBack}>&larr; Back</Button>
                    <Title order={5}>Viewer</Title>
                    <ActionIcon variant="subtle" size="sm" onClick={() => setSettingsOpen(true)}>
                        <IconSettings size={16} />
                    </ActionIcon>
                </Group>

                <Group>
                    {(isSyncing || isSaving || isInsertingAudio || isGenerating) && (
                        <Group gap="xs" mr="xs">
                            {isSyncing && <Text size="xs" c="dimmed">Syncing...</Text>}
                            {isSaving && <Text size="xs" c="dimmed">{saveStatus}</Text>}
                            {isInsertingAudio && <Text size="xs" c="dimmed">{insertStatus}</Text>}
                            {isRemoving && <Text size="xs" c="dimmed">{removeStatus}</Text>}
                            {isGenerating && <Text size="xs" c="dimmed">{genStatus}</Text>}
                        </Group>
                    )}

                    <Button
                        variant="default"
                        size="xs"
                        leftSection={<IconRefresh size={14} className={isSyncing ? "mantine-rotate" : ""} />}
                        onClick={handleSyncAll}
                        loading={isSyncing}
                        disabled={busy}
                    >
                        Sync All Slides
                    </Button>

                    <Button
                        variant="filled"
                        color="blue"
                        size="xs"
                        onClick={handleInsertAllAudio}
                        loading={isInsertingAudio}
                        disabled={busy}
                    >
                        Insert All Audio
                    </Button>

                    <Button
                        variant="default"
                        size="xs"
                        onClick={handleSaveAllNotes}
                        loading={isSaving}
                        disabled={busy}
                    >
                        Save All Slides
                    </Button>

                    <Button
                        variant="default"
                        size="xs"
                        onClick={handleRemoveAllAudio}
                        loading={isRemoving}
                        disabled={busy}
                    >
                        Remove All Audio
                    </Button>

                    <Button
                        size="xs"
                        variant="light"
                        color="blue"
                        onClick={handleGenerateVideo}
                        loading={isGenerating}
                        disabled={busy}
                    >
                        {isGenerating ? 'Generating...' : 'Generate Video'}
                    </Button>
                </Group>
            </Group>

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left Panel: Thumbnails */}
                <div style={{ width: '250px', height: '100%', borderRight: '1px solid var(--mantine-color-dark-4)', display: 'flex', flexDirection: 'column' }}>
                    <ScrollArea style={{ flex: 1 }} type="auto">
                        <Box p="md">
                            {slides.map((slide, index) => (
                                <Box
                                    key={slide.index}
                                    onClick={() => setActiveSlideIndex(index)}
                                    style={{
                                        marginBottom: '1rem',
                                        cursor: 'pointer',
                                        border: activeSlideIndex === index ? '2px solid var(--mantine-color-blue-6)' : '2px solid transparent',
                                        borderRadius: '4px',
                                        position: 'relative'
                                    }}
                                >
                                    <div style={{
                                        position: 'absolute',
                                        top: 4,
                                        left: 4,
                                        zIndex: 10,
                                        background: 'rgba(0,0,0,0.6)',
                                        color: 'white',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 'bold',
                                        pointerEvents: 'none'
                                    }}>
                                        {index + 1}
                                    </div>
                                    <Image src={slide.src} radius="sm" />
                                </Box>
                            ))}
                        </Box>
                    </ScrollArea>
                </div>

                {/* Right Panel (Resizable) */}
                <div
                    ref={splitContainerRef}
                    style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--mantine-color-body)' }}
                >
                    {/* Top: Slide View */}
                    <Box style={{
                        height: `${splitRatio}%`,
                        position: 'relative',
                        padding: '1rem',
                        background: 'var(--mantine-color-dark-8)',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <Image
                            src={activeSlide.src}
                            fit="contain"
                            style={{ maxHeight: '100%', maxWidth: '100%' }}
                        />
                    </Box>

                    {/* Resize Handle */}
                    <div
                        onMouseDown={handleResizeMouseDown}
                        style={{
                            height: '6px',
                            background: 'var(--mantine-color-dark-4)',
                            cursor: 'ns-resize',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10
                        }}
                    >
                        <div style={{ width: 30, height: 2, background: 'var(--mantine-color-dimmed)', borderRadius: 1 }} />
                    </div>

                    {/* Bottom: Notes + Toolbar */}
                    <Box style={{ flex: 1, height: `${100 - splitRatio}%`, padding: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                        <Group gap="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
                            <Tooltip
                                label="Individual slide sync is disabled in XML mode"
                                disabled={!xmlCliEnabled}
                            >
                                <Button
                                    variant="default"
                                    size="xs"
                                    leftSection={<IconRefresh size={14} className={isSyncing ? "mantine-rotate" : ""} />}
                                    onClick={handleSyncSlide}
                                    loading={isSyncing}
                                    disabled={busy || xmlCliEnabled}
                                >
                                    Sync Slide
                                </Button>
                            </Tooltip>

                            <Button
                                variant="filled"
                                color="blue"
                                size="xs"
                                onClick={handleInsertSlideAudio}
                                loading={isInsertingAudio}
                                disabled={busy}
                            >
                                Insert Audio
                            </Button>

                            <Tooltip
                                label="Disabled when XML CLI is enabled"
                                disabled={!xmlCliEnabled}
                            >
                                <Button
                                    variant="default"
                                    size="xs"
                                    leftSection={<IconDeviceTv size={14} />}
                                    onClick={handlePlaySlide}
                                    disabled={busy || xmlCliEnabled}
                                >
                                    Play
                                </Button>
                            </Tooltip>

                            <Button
                                variant="default"
                                size="xs"
                                onClick={handleSaveCurrentSlideNotes}
                                loading={isSaving}
                                disabled={busy}
                            >
                                Save Slide
                            </Button>

                                <Button
                                    variant="default"
                                    size="xs"
                                    onClick={handleRemoveSlideAudio}
                                    loading={isRemoving}
                                    disabled={busy}
                                >
                                Remove Audio
                            </Button>
                            {isRemoving && removeStatus && (
                                <Text size="xs" c="dimmed" ml="xs">
                                    {removeStatus}
                                </Text>
                            )}
                        </Group>

                        {/* SSML Toolbar (Second) */}
                        <Group gap={0} mb="xs" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: '4px', padding: '4px', background: 'var(--mantine-color-dark-6)' }}>
                            <ActionIcon variant="subtle" color="gray" size="lg" onClick={handleUndo} disabled={historyIndex === 0}>
                                <IconArrowBackUp style={{ width: rem(18), height: rem(18) }} />
                            </ActionIcon>
                            <ActionIcon variant="subtle" color="gray" size="lg" onClick={handleRedo} disabled={historyIndex === history.length - 1}>
                                <IconArrowForwardUp style={{ width: rem(18), height: rem(18) }} />
                            </ActionIcon>

                            <div style={{ width: 1, height: 20, background: 'var(--mantine-color-dark-4)', margin: '0 8px' }} />

                            <Menu shadow="md" width={220} trigger="click" position="bottom-start" offset={0} closeOnItemClick={false}>
                                <Menu.Target>
                                    <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Break time">
                                        <IconPlayerPause style={{ width: rem(18), height: rem(18) }} />
                                        <IconChevronDown style={{ width: rem(12), height: rem(12), marginLeft: 4 }} />
                                    </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Label>Break Duration</Menu.Label>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertSelfClosingTag('<break time="200ms"/>')}>200 ms</Menu.Item>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertSelfClosingTag('<break time="500ms"/>')}>500 ms</Menu.Item>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertSelfClosingTag('<break time="1s"/>')}>1 second</Menu.Item>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertSelfClosingTag('<break time="2s"/>')}>2 seconds</Menu.Item>

                                    <Menu.Divider />
                                    <Menu.Label>Custom</Menu.Label>
                                    <Box p="xs" pt={0}>
                                        <Group gap={5}>
                                            <TextInput
                                                placeholder="e.g. 3s or 500ms"
                                                size="xs"
                                                value={customBreak}
                                                onChange={(e) => setCustomBreak(e.currentTarget.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        handleCustomBreak();
                                                        // Close menu logic if needed, but keeping open for now
                                                    }
                                                }}
                                                style={{ flex: 1 }}
                                            />
                                            <ActionIcon variant="filled" color="blue" size="sm" onClick={handleCustomBreak}>
                                                <IconPlus size={14} />
                                            </ActionIcon>
                                        </Group>
                                    </Box>
                                </Menu.Dropdown>
                            </Menu>

                            <Menu shadow="md" width={200} trigger="hover" position="bottom-start" offset={0}>
                                <Menu.Target>
                                    <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Say As">
                                        <IconKeyboard style={{ width: rem(18), height: rem(18) }} />
                                        <IconChevronDown style={{ width: rem(12), height: rem(12), marginLeft: 4 }} />
                                    </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Label>Interpret As</Menu.Label>
                                    <Menu.Item onClick={() => insertWrappedTag('<say-as interpret-as="spell-out">', '</say-as>')}>Spell Out</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<say-as interpret-as="cardinal">', '</say-as>')}>Number (Cardinal)</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<say-as interpret-as="ordinal">', '</say-as>')}>Ordinal (1st, 2nd)</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<say-as interpret-as="digits">', '</say-as>')}>Digits</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<say-as interpret-as="fraction">', '</say-as>')}>Fraction</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<say-as interpret-as="expletive">', '</say-as>')}>Expletive</Menu.Item>
                                </Menu.Dropdown>
                            </Menu>

                            <Menu shadow="md" width={200} trigger="hover" position="bottom-start" offset={0}>
                                <Menu.Target>
                                    <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Emphasis">
                                        <IconVolume style={{ width: rem(18), height: rem(18) }} />
                                        <IconChevronDown style={{ width: rem(12), height: rem(12), marginLeft: 4 }} />
                                    </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Label>Emphasis Level</Menu.Label>
                                    <Menu.Item onClick={() => insertWrappedTag('<emphasis level="strong">', '</emphasis>')}>Strong</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<emphasis level="moderate">', '</emphasis>')}>Moderate</Menu.Item>
                                    <Menu.Item onClick={() => insertWrappedTag('<emphasis level="reduced">', '</emphasis>')}>Reduced</Menu.Item>
                                </Menu.Dropdown>
                            </Menu>

                            <Tooltip label="Paragraph">
                                <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => insertWrappedTag('<p>', '</p>')}>
                                    <IconPilcrow style={{ width: rem(18), height: rem(18) }} />
                                </ActionIcon>
                            </Tooltip>

                            <div style={{ width: 1, height: 20, background: 'var(--mantine-color-dark-4)', margin: '0 8px' }} />
                        </Group>

                        {/* Notes Sections (Third) */}
                        <Text size="sm" fw={500} mb={4}>Presenter Notes</Text>
                        <ScrollArea style={{ flex: 1 }} type="auto" styles={{ viewport: { '& > div': { display: 'flex', flexDirection: 'column', height: '100%' } } }}>
                            <Box style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '12px' }}>
                                {parseNotes(activeSlide.notes || '').map((section, index, arr) => (
                                    <Box key={index} style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 4, display: 'flex', flexDirection: 'column', minHeight: 150, flexShrink: 0 }}>
                                        {/* Header */}
                                        <Group justify="space-between" px="xs" py={4} style={{ borderBottom: '1px solid var(--mantine-color-dark-4)', background: 'var(--mantine-color-dark-6)' }}>
                                            <Select
                                                data={[{ value: DEFAULT_SPEAKER_VALUE, label: DEFAULT_SPEAKER_LABEL }].concat(Object.keys(mappings).filter((key) => key !== DEFAULT_SPEAKER_KEY).map((key) => ({ value: key, label: `[${key}]` })))}
                                                value={section.speaker}
                                                onChange={(val) => handleSpeakerChange(index, val)}
                                                size="xs"
                                                w={150}
                                                placeholder="Speaker"
                                            />
                                            {arr.length > 1 && (
                                                <Button variant="subtle" color="red" size="compact-xs" onClick={() => handleDeleteSection(index)}>
                                                    Remove Section
                                                </Button>
                                            )}
                                        </Group>
                                        {/* Audio Player and Body */}
                                        <SectionPreviewButtons section={section} mappings={mappings} onFocus={() => setActiveSectionIndex(index)} getTextarea={() => textareasRefs.current[index]} />
                                        <Textarea
                                            ref={el => { textareasRefs.current[index] = el; }}
                                            onFocus={() => setActiveSectionIndex(index)}
                                            value={section.text}
                                            onChange={(e) => handleSectionTextChange(index, e.target.value)}
                                            styles={{
                                                input: { resize: 'vertical', fontFamily: 'monospace', border: 'none', minHeight: '110px' }
                                            }}
                                        />
                                    </Box>
                                ))}
                                <Button variant="light" size="sm" fullWidth leftSection={<IconPlus size={16}/>} onClick={handleAddSection} style={{ flexShrink: 0, marginBottom: '20px' }}>
                                    Add Section
                                </Button>
                            </Box>
                        </ScrollArea>
                    </Box>
                </div>
            </div>
            {/* Overlays */}
            <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
    );
}

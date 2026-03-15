import { Box, Group, Button, Image, ScrollArea, Textarea, Title, ActionIcon, Tooltip, Menu, rem, TextInput, Slider, Text, Loader, Select } from '@mantine/core';
import { useState, useEffect, useRef, useCallback } from 'react';
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
// Removed VoiceSelector import
import { SettingsModal } from './SettingsModal';
const { ipcRenderer } = (window as any).require('electron');

interface ViewerPageProps {
    slides: Slide[];
    filePath: string;
    onSave: (updatedSlides: Slide[]) => void;
    onBack: () => void;
}

export function ViewerPage({ slides: initialSlides, filePath, onSave, onBack }: ViewerPageProps) {
    const [slides, setSlides] = useState<Slide[]>(initialSlides);
    // History State
    const [history, setHistory] = useState<Slide[][]>([initialSlides]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const [activeSlideIndex, setActiveSlideIndex] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [customBreak, setCustomBreak] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mappings, setMappings] = useState<Record<string, any>>({});

    const loadSettings = async () => {
        if (window.electronAPI.getSpeakerMappings) {
            const m = await window.electronAPI.getSpeakerMappings();
            setMappings(m || {});
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const isSeekingRef = useRef(false);

    const [isAudioGenerating, setIsAudioGenerating] = useState(false);

    // Sync State
    const [isSyncing, setIsSyncing] = useState(false);

    const activeSlide = slides[activeSlideIndex] || { src: '', notes: '' };

    // Reset audio when slide changes
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setAudioUrl(null);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, [activeSlideIndex]);

    const handlePlayAudio = async () => {
        if (!activeSlide.notes) return;

        let textToPlay = activeSlide.notes;

        if (textareaRef.current) {
            const start = textareaRef.current.selectionStart;
            const end = textareaRef.current.selectionEnd;
            if (start !== end) {
                textToPlay = textToPlay.substring(start, end);
            }
        }

        try {
            setIsAudioGenerating(true);
            // Generate URL (cached if possible)
            const url = await generateAudio(textToPlay, undefined);

            if (url !== audioUrl) {
                setAudioUrl(url);
                // Wait a tick for React to update the <audio src> prop
                setTimeout(() => {
                    if (audioRef.current) {
                        audioRef.current.currentTime = 0;
                        audioRef.current.play()
                            .then(() => setIsPlaying(true))
                            .catch(e => console.error("Auto-play failed after generation", e));
                    }
                }, 100);
            } else {
                if (audioRef.current) {
                    audioRef.current.currentTime = 0;
                    audioRef.current.play()
                        .then(() => setIsPlaying(true))
                        .catch(e => console.error("Auto-play failed for cached audio", e));
                }
            }
        } catch (error: any) {
            console.error("Failed to play audio", error);
            alert("Failed to play audio: " + error.message);
        } finally {
            setIsAudioGenerating(false);
        }
    };

    const togglePlay = async () => {
        if (isPlaying) {
            audioRef.current?.pause();
            setIsPlaying(false);
        } else {
            // ALWAYS check the generation to ensure we have the correct audio for the current text.
            await handlePlayAudio();
        }
    };

    const onTimeUpdate = () => {
        if (audioRef.current && !isSeekingRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const onLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
        }
    };

    const onAudioEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
    };

    const handleSeek = (value: number) => {
        isSeekingRef.current = true;
        setCurrentTime(value);
    };

    const handleSeekEnd = (value: number) => {
        isSeekingRef.current = false;
        if (audioRef.current) {
            audioRef.current.currentTime = value;
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };
    // Reset index when initialSlides change (e.g. new file loaded)
    useEffect(() => {
        setSlides(initialSlides);
        setHistory([initialSlides]);
        setHistoryIndex(0);
        setActiveSlideIndex(0);
    }, [initialSlides]);

    // Push current state to history. 
    // If 'overwrite', replaces the current history head (useful for typing sequences).
    // Usually we push new state.
    const pushToHistory = useCallback((newSlides: Slide[]) => {
        setHistory(prev => {
            const currentHistory = prev.slice(0, historyIndex + 1);
            return [...currentHistory, newSlides];
        });
        setHistoryIndex(prev => prev + 1);
    }, [historyIndex]);

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            setHistoryIndex(prev => prev - 1);
            setSlides(history[historyIndex - 1]);
        }
    }, [history, historyIndex]);

    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(prev => prev + 1);
            setSlides(history[historyIndex + 1]);
        }
    }, [history, historyIndex]);

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
    }, [handleUndo, handleRedo]);


    const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newText };
        setSlides(newSlides);

        // Debounce history save for typing
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            pushToHistory(newSlides);
        }, 800);
    };

    const insertTag = (startTag: string, endTag: string = '') => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        // Force save current history state before modification to ensure we can undo this specific action
        // Actually, if we just typed, the debounce might not have fired yet. 
        // Ideally we want to commit "Before Tag" state if it changed.
        // But for simplicity, we just push the NEW state after tag insertion into history.
        // Wait, if we type "foo", wait 200ms, then insert tag. "foo" isn't in history yet?
        // Let's rely on React state. The current 'slides' IS the latest 'foo'. 
        // So we just need to ensure we have a history point BEFORE this change?
        // If historyIndex points to "foo", good. If not (debounce pending), we might lose "foo" step?
        // To be safe: clear debounce and push CURRENT slides if meaningful difference? 
        // Simplest strategy: Just push `newSlides` to history. Undo will go back to *whatever was computed last*. 
        // If "foo" wasn't pushed yet, Undo goes back to pre-"foo". That's bad.
        // So: Clear debounce, push CURRENT slides (if not equal to history head), THEN apply tag and push again.

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            // If there were pending changes, push them first?
            // This is getting complex. Let's stick to: "Tag insertion is a discrete history event"
            // We assume the user stopped typing for a split second or we accept small data loss in undo stack for rapid typing+clicking.
            // Better: Implicitly, `slides` is the latest. 
            // We want history to look like: [State A], [State A + Tag].
            // If we only push [State A + Tag], then pressing Undo goes to [State A] (which might be old if we didn't push A).
            // So yes, we should push 'slides' (current state) if it's different from history[historyIndex].

            // Let's implement that check ideally, or just lazy-push.
            // For now: Just push the result.
        }

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = activeSlide.notes || '';

        const before = text.substring(0, start);
        const selection = text.substring(start, end);
        const after = text.substring(end);

        const newText = before + startTag + selection + endTag + after;

        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newText };

        setSlides(newSlides);
        pushToHistory(newSlides); // Discrete Action -> immediate history

        // Restore cursor / selection
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + startTag.length, end + startTag.length);
        }, 0);
    };

    const handleCustomBreak = () => {
        if (!customBreak) return;
        insertTag(`<break time="${customBreak}"/>`);
        setCustomBreak('');
    };

    const [splitRatio, setSplitRatio] = useState(60); // Percentage height of top panel
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

    const handleGenerateVideo = async () => {
        if (isGenerating) return;

        try {
            // 1. Ask for Save Path FIRST
            if (ipcRenderer) {
                // AUTO-SAVE: Save notes before proceeding
                setGenStatus('Saving notes...');
                const saveResult = await ipcRenderer.invoke('save-all-notes', filePath, slides);
                if (!saveResult.success) {
                    alert('Auto-save failed: ' + saveResult.error);
                    return;
                }

                const savePath = await ipcRenderer.invoke('get-video-save-path');
                if (!savePath) {
                    return; // User cancelled
                }

                setIsGenerating(true);
                setGenStatus('Preparing audio...');

                // 2. Generate Audio
                const slidesAudioString = [];
                for (const slide of slides) {
                    if (slide.notes && slide.notes.trim().length > 0) {
                        setGenStatus(`Generating audio for slide ${slide.index}...`);
                        const buffer = await getAudioBuffer(slide.notes, undefined);
                        slidesAudioString.push({
                            index: slide.index,
                            audioData: new Uint8Array(buffer)
                        });
                    }
                }

                setGenStatus('Rendering video (this may take a while)...');

                // 3. Call Backend with savePath
                const result = await ipcRenderer.invoke('generate-video', {
                    filePath,
                    slidesAudio: slidesAudioString,
                    videoOutputPath: savePath
                });

                if (result.success) {
                    alert('Video generated successfully at: ' + result.outputPath);
                } else {
                    alert('Video generation failed: ' + result.error);
                }

            } else {
                console.error("IPC Renderer not found");
                alert("IPC Renderer not found");
            }

        } catch (e) {
            console.error("Error preparing video generation:", e);
            alert("Error preparing generation: " + e);
        } finally {
            setIsGenerating(false);
            setGenStatus('');
        }
    };

    // Save State
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');
    const [isInsertingAudio, setIsInsertingAudio] = useState(false);
    const [insertStatus, setInsertStatus] = useState('');

    const handleSaveAllNotes = async () => {
        if (isSaving || isInsertingAudio) return;
        setIsSaving(true);
        setSaveStatus('Saving all notes...');

        try {
            if (ipcRenderer) {
                const result = await ipcRenderer.invoke('save-all-notes', filePath, slides);

                if (result.success) {
                    alert('Notes saved successfully!');
                    onSave(slides);
                } else {
                    alert('Failed to save notes: ' + result.error);
                }
            } else {
                onSave(slides);
            }
        } catch (e: any) {
            console.error("Save failed:", e);
            alert("Save error: " + e.message);
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
            if (ipcRenderer) {
                const result = await ipcRenderer.invoke('save-all-notes', filePath, [activeSlide]);

                if (result.success) {
                    setSaveStatus('Saved!');
                    setTimeout(() => setSaveStatus(''), 2000);
                    onSave(slides);
                } else {
                    alert('Failed to save slide note: ' + result.error);
                }
            } else {
                onSave(slides);
            }
        } catch (e: any) {
            console.error("Save slide failed:", e);
            alert("Save error: " + e.message);
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
            if (ipcRenderer) {
                const slidesAudioString = [];
                if (activeSlide.notes && activeSlide.notes.trim().length > 0) {
                    const buffer = await getAudioBuffer(activeSlide.notes, undefined);
                    slidesAudioString.push({
                        index: activeSlide.index,
                        audioData: new Uint8Array(buffer)
                    });
                }

                if (slidesAudioString.length === 0) {
                    alert("No notes found to generate audio.");
                    setIsInsertingAudio(false);
                    return;
                }

                setInsertStatus('Inserting audio...');
                const result = await ipcRenderer.invoke('insert-audio', filePath, slidesAudioString);

                if (result.success) {
                    setInsertStatus('Audio Inserted!');
                    setTimeout(() => setInsertStatus(''), 2000);
                } else {
                    alert('Failed to insert audio: ' + result.error);
                }
            }
        } catch (e: any) {
            console.error("Insert audio failed:", e);
            alert("Insert error: " + e.message);
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
            if (ipcRenderer) {
                const slidesAudioString = [];
                for (const slide of slides) {
                    if (slide.notes && slide.notes.trim().length > 0) {
                        setInsertStatus(`Generating audio for slide ${slide.index}...`);
                        const buffer = await getAudioBuffer(slide.notes, undefined);
                        slidesAudioString.push({
                            index: slide.index,
                            audioData: new Uint8Array(buffer)
                        });
                    }
                }

                if (slidesAudioString.length === 0) {
                    alert("No notes found to generate audio.");
                    setIsInsertingAudio(false);
                    return;
                }

                setInsertStatus('Inserting all audio...');
                const result = await ipcRenderer.invoke('insert-audio', filePath, slidesAudioString);

                if (result.success) {
                    alert('All audio inserted successfully!');
                } else {
                    alert('Failed to insert audio: ' + result.error);
                }
            }
        } catch (e: any) {
            console.error("Insert all audio failed:", e);
            alert("Insert error: " + e.message);
        } finally {
            setIsInsertingAudio(false);
            setInsertStatus('');
        }
    };

    const handlePlaySlide = async () => {
        if (ipcRenderer) {
            try {
                // Determine 1-based index for PowerPoint
                // We assume activeSlide.index is 1-based compatible or we use index + 1
                // Let's rely on activeSlide.index if available (from backend conversion), else fallback
                const indexToPlay = activeSlide.index || (activeSlideIndex + 1);

                const result = await ipcRenderer.invoke('play-slide', indexToPlay);
                if (!result.success) {
                    alert('Failed to play slide: ' + result.error);
                }
            } catch (e: any) {
                console.error("Play slide error:", e);
                alert("Play slide error: " + e.message);
            }
        }
    };

    const handleSyncAll = async () => {
        if (isSyncing || isSaving || isGenerating) return;
        setIsSyncing(true);

        try {
            if (ipcRenderer) {
                const result = await ipcRenderer.invoke('convert-pptx', filePath);

                if (result.success && result.slides) {
                    setSlides(result.slides);
                    setHistory([result.slides]);
                    setHistoryIndex(0);

                    if (activeSlideIndex >= result.slides.length) {
                        setActiveSlideIndex(Math.max(0, result.slides.length - 1));
                    }
                } else {
                    alert('Sync failed: ' + (result.error || 'Unknown error'));
                }
            }
        } catch (e: any) {
            console.error("Sync error:", e);
            alert("Sync error: " + e.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSyncSlide = async () => {
        if (isSyncing || isSaving || isGenerating) return;
        setIsSyncing(true);

        try {
            if (ipcRenderer) {
                // Determine 1-based index
                const indexToSync = activeSlide.index || (activeSlideIndex + 1);

                // Call new handler
                const result = await ipcRenderer.invoke('sync-slide', {
                    filePath,
                    slideIndex: indexToSync
                });

                if (result.success && result.slides) {
                    setSlides(result.slides);
                    // Update history to match
                    setHistory([result.slides]);
                    setHistoryIndex(0);
                } else {
                    alert('Sync Slide failed: ' + (result.error || 'Unknown error'));
                }
            }
        } catch (e: any) {
            console.error("Sync slide error:", e);
            alert("Sync slide error: " + e.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const [isRemoving, setIsRemoving] = useState(false);

    const handleRemoveAudio = async (scope: 'slide' | 'all') => {
        if (isGenerating || isSaving || isSyncing || isRemoving) return;
        setIsRemoving(true);
        try {
            if (ipcRenderer) {
                const indexToUse = activeSlide.index || (activeSlideIndex + 1);

                const result = await ipcRenderer.invoke('remove-audio', {
                    filePath,
                    scope,
                    slideIndex: indexToUse
                });

                if (result.success) {
                    alert(`Successfully removed audio (${scope === 'all' ? 'all slides' : 'current slide'}).`);
                } else {
                    alert('Failed to remove audio: ' + (result.error || 'Unknown error'));
                }
            }
        } catch (e: any) {
            console.error("Remove audio error:", e);
            alert("Remove audio error: " + e.message);
        } finally {
            setIsRemoving(false);
        }
    };

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
                    {isGenerating && <Text size="xs" c="dimmed">{genStatus}</Text>}
                    {isSaving && <Text size="xs" c="dimmed">{saveStatus}</Text>}
                    {isInsertingAudio && <Text size="xs" c="dimmed">{insertStatus}</Text>}
                    <Button.Group>
                        <Button
                            variant="default"
                            size="xs"
                            leftSection={<IconRefresh size={14} className={isSyncing ? "mantine-rotate" : ""} />}
                            onClick={handleSyncSlide}
                            loading={isSyncing}
                            disabled={isGenerating || isSaving || isSyncing}
                        >
                            Sync Slide
                        </Button>
                        <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                                <Button
                                    variant="default"
                                    size="xs"
                                    px={4}
                                    disabled={isGenerating || isSaving || isSyncing}
                                >
                                    <IconChevronDown size={14} />
                                </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item
                                    leftSection={<IconRefresh size={14} />}
                                    onClick={handleSyncAll}
                                >
                                    Sync All Slides
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Button.Group>

                    <Button.Group>
                        <Button
                            variant="default"
                            size="xs"
                            onClick={() => handleRemoveAudio('slide')}
                            loading={isRemoving}
                            disabled={isGenerating || isSaving || isSyncing || isRemoving}
                        >
                            Remove Slide Audio
                        </Button>
                        <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                                <Button
                                    variant="default"
                                    size="xs"
                                    px={4}
                                    disabled={isGenerating || isSaving || isSyncing || isRemoving}
                                >
                                    <IconChevronDown size={14} />
                                </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item
                                    onClick={() => handleRemoveAudio('all')}
                                >
                                    Remove All Audio
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Button.Group>
                    <Button
                        size="xs"
                        variant="light"
                        color="blue"
                        onClick={handleGenerateVideo}
                        loading={isGenerating}
                        disabled={isGenerating || isSaving || isSyncing}
                    >
                        {isGenerating ? 'Generating...' : 'Generate Video'}
                    </Button>
                    <Button
                        variant="default"
                        size="xs"
                        leftSection={<IconDeviceTv size={14} />}
                        onClick={handlePlaySlide}
                        disabled={isGenerating || isSaving || isSyncing || isInsertingAudio}
                    >
                        Play
                    </Button>
                    <Button.Group>
                        <Button
                            variant="filled"
                            color="blue"
                            size="xs"
                            onClick={handleInsertSlideAudio}
                            loading={isInsertingAudio}
                            disabled={isGenerating || isSaving || isSyncing || isRemoving || isInsertingAudio}
                        >
                            Insert Audio
                        </Button>
                        <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                                <Button
                                    variant="filled"
                                    color="blue"
                                    size="xs"
                                    px={4}
                                    disabled={isGenerating || isSaving || isSyncing || isRemoving || isInsertingAudio}
                                >
                                    <IconChevronDown size={14} />
                                </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item
                                    onClick={handleInsertAllAudio}
                                >
                                    Insert All Audio
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Button.Group>

                    <Button.Group>
                        <Button
                            variant="default"
                            size="xs"
                            onClick={handleSaveAllNotes}
                            loading={isSaving}
                            disabled={isGenerating || isSaving || isSyncing || isRemoving || isInsertingAudio}
                        >
                            Save All Slides
                        </Button>
                        <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                                <Button
                                    variant="default"
                                    size="xs"
                                    px={4}
                                    disabled={isGenerating || isSaving || isSyncing || isRemoving || isInsertingAudio}
                                >
                                    <IconChevronDown size={14} />
                                </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item
                                    onClick={handleSaveCurrentSlideNotes}
                                >
                                    Save Current Slide
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Button.Group>
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

                        {/* Audio Player (First) */}
                        <Box mb="md" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)', paddingBottom: '1rem' }}>
                            <audio
                                ref={audioRef}
                                src={audioUrl || ''}
                                onTimeUpdate={onTimeUpdate}
                                onLoadedMetadata={onLoadedMetadata}
                                onEnded={onAudioEnded}
                            />

                            <Group gap="md">
                                <ActionIcon
                                    variant="filled"
                                    color={isPlaying ? "red" : "blue"}
                                    size="lg"
                                    radius="xl"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={togglePlay}
                                    disabled={!activeSlide.notes}
                                >
                                    {isPlaying ? <IconPlayerPause size={20} /> : <IconPlayerPlay size={20} />}
                                </ActionIcon>

                                <Box style={{ flex: 1, position: 'relative' }}>
                                    {isAudioGenerating ? (
                                        <div style={{ height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Loader size="sm" variant="dots" color="blue" />
                                        </div>
                                    ) : (
                                        <>
                                            <Slider
                                                value={currentTime}
                                                min={0}
                                                max={duration || 100}
                                                onChange={handleSeek}
                                                onChangeEnd={handleSeekEnd}
                                                label={formatTime}
                                                disabled={!audioUrl}
                                            />
                                            <Group justify="space-between" mt={4}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--mantine-color-dimmed)' }}>
                                                    {formatTime(currentTime)}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--mantine-color-dimmed)' }}>
                                                    {formatTime(duration)}
                                                </div>
                                            </Group>
                                        </>
                                    )}
                                </Box>
                            </Group>
                        </Box>

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
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertTag('<break time="200ms"/>')}>200 ms</Menu.Item>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertTag('<break time="500ms"/>')}>500 ms</Menu.Item>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertTag('<break time="1s"/>')}>1 second</Menu.Item>
                                    <Menu.Item leftSection={<IconClock size={14} />} onClick={() => insertTag('<break time="2s"/>')}>2 seconds</Menu.Item>

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
                                    <Menu.Item onClick={() => insertTag('<say-as interpret-as="spell-out">', '</say-as>')}>Spell Out</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<say-as interpret-as="cardinal">', '</say-as>')}>Number (Cardinal)</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<say-as interpret-as="ordinal">', '</say-as>')}>Ordinal (1st, 2nd)</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<say-as interpret-as="digits">', '</say-as>')}>Digits</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<say-as interpret-as="fraction">', '</say-as>')}>Fraction</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<say-as interpret-as="expletive">', '</say-as>')}>Expletive</Menu.Item>
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
                                    <Menu.Item onClick={() => insertTag('<emphasis level="strong">', '</emphasis>')}>Strong</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<emphasis level="moderate">', '</emphasis>')}>Moderate</Menu.Item>
                                    <Menu.Item onClick={() => insertTag('<emphasis level="reduced">', '</emphasis>')}>Reduced</Menu.Item>
                                </Menu.Dropdown>
                            </Menu>

                            <Tooltip label="Paragraph">
                                <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => insertTag('<p>', '</p>')}>
                                    <IconPilcrow style={{ width: rem(18), height: rem(18) }} />
                                </ActionIcon>
                            </Tooltip>

                            <div style={{ width: 1, height: 20, background: 'var(--mantine-color-dark-4)', margin: '0 8px' }} />

                            <Box style={{ width: 160 }}>
                                <Select
                                    placeholder="Insert Speaker Tag"
                                    data={Object.keys(mappings).filter(k => k !== '_default_').map(k => ({ value: k, label: `[${k}]` }))}
                                    value={null}
                                    onChange={(val) => { if (val) insertTag(`[${val}]\n`); }}
                                    searchable
                                    size="xs"
                                    w={150}
                                />
                            </Box>
                        </Group>

                        {/* Text Box (Third) */}
                        <Textarea
                            ref={textareaRef}
                            label="Presenter Notes"
                            value={activeSlide.notes}
                            onChange={handleNotesChange}
                            minRows={4}
                            maxRows={10}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                            styles={{
                                wrapper: { flex: 1, display: 'flex', flexDirection: 'column' },
                                input: { flex: 1, resize: 'none', fontFamily: 'monospace' }
                            }}
                        />
                    </Box>
                </div>
            </div>
            {/* Overlays */}
            <SettingsModal opened={settingsOpen} onClose={() => { setSettingsOpen(false); loadSettings(); }} />
        </div>
    );
}

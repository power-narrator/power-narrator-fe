import { Box, Group, Button, Image, ScrollArea, Textarea, Title, ActionIcon, Tooltip, Menu, rem, TextInput, Text, Select, Slider, Loader } from '@mantine/core';
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

export interface NoteSection {
    speaker: string;
    text: string;
}

export const parseNotes = (text: string): NoteSection[] => {
    if (!text) return [{ speaker: '', text: '' }];
    
    // Split more leniently but effectively. We want to avoid trailing space deletion.
    const parts = text.split(/\r?\n---\r?\n/g);
    if (parts.length === 1 && text.includes('---')) {
        // Fallback if manual string didn't have exact newlines around ---
        const fallbackParts = text.split(/^\s*---\s*$/gm);
        return fallbackParts.map(part => {
            const match = part.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
            if (match) return { speaker: match[1], text: match[2] };
            // Strip up to one leading newline
            return { speaker: '', text: part.replace(/^\s*\r?\n/, '') };
        });
    }

    return parts.map(part => {
        // Attempt strict match first to avoid consuming trailing spaces in tags
        const match = part.match(/^\[([^\]]+)\]\n([\s\S]*)$/);
        if (match) {
            return { speaker: match[1], text: match[2] };
        }
        
        // Legacy match
        const legacyMatch = part.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
        if (legacyMatch) {
            return { speaker: legacyMatch[1], text: legacyMatch[2] };
        }
        
        return { speaker: '', text: part };
    });
};

export const formatNotes = (sections: NoteSection[]): string => {
    return sections.map(sec => {
        const speakerPart = sec.speaker && sec.speaker !== '_default_' ? `[${sec.speaker}]\n` : '';
        return `${speakerPart}${sec.text}`;
    }).join('\n---\n');
};

const SectionPreviewButtons = ({ section, mappings, onFocus, getTextarea }: { section: NoteSection, mappings: Record<string, any>, onFocus: () => void, getTextarea?: () => HTMLTextAreaElement | null }) => {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [playingSpeaker, setPlayingSpeaker] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const isSeekingRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isAudioGenerating, setIsAudioGenerating] = useState(false);

    const speakers = [{ value: '', label: 'Default' }].concat(Object.keys(mappings).filter(k => k !== '_default_').map(k => ({ value: k, label: k })));

    const handlePlay = async (speakerValue: string, isMainPlayer: boolean = false) => {
        const targetSpeaker = isMainPlayer ? section.speaker : speakerValue;

        if (playingSpeaker === (isMainPlayer ? 'MAIN' : targetSpeaker)) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            setPlayingSpeaker(null);
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
            setPlayingSpeaker(isMainPlayer ? 'MAIN' : targetSpeaker);
            
            const voiceOverride = targetSpeaker ? mappings[targetSpeaker] : undefined;
            const url = await generateAudio(textToPlay, voiceOverride);
            
            setAudioUrl(url);
            setTimeout(() => {
                if (audioRef.current) {
                    audioRef.current.currentTime = 0;
                    audioRef.current.play().catch(e => {
                        console.error(e);
                        setPlayingSpeaker(null);
                    });
                }
            }, 100);
        } catch (error: any) {
            alert("Failed to play audio: " + error.message);
            setPlayingSpeaker(null);
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
                onTimeUpdate={() => { if (audioRef.current && !isSeekingRef.current) setCurrentTime(audioRef.current.currentTime); }}
                onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
                onEnded={() => setPlayingSpeaker(null)}
            />
            
            <Group gap="xs" mb="xs">
                {speakers.map(spk => {
                    const isPlaying = playingSpeaker === spk.value;
                    const isGenerating = isAudioGenerating && playingSpeaker === spk.value;
                    return (
                        <Button
                            key={spk.value}
                            size="compact-sm"
                            variant="outline"
                            color="blue"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handlePlay(spk.value, false)}
                            loading={isGenerating}
                            disabled={isAudioGenerating && !isGenerating}
                            leftSection={isPlaying ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                        >
                            {spk.label}
                        </Button>
                    );
                })}
            </Group>

            <Group gap="xs">
                <ActionIcon
                    variant="filled"
                    color={playingSpeaker === 'MAIN' ? "red" : "blue"}
                    size="sm"
                    radius="xl"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePlay('', true)}
                    disabled={(!section.text) || (isAudioGenerating && playingSpeaker !== 'MAIN')}
                >
                    {playingSpeaker === 'MAIN' && !isAudioGenerating ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                </ActionIcon>
                <Box style={{ flex: 1, position: 'relative' }}>
                    {isAudioGenerating && playingSpeaker === 'MAIN' ? (
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
    const [activeSectionIndex, setActiveSectionIndex] = useState(0);
    const textareasRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
    const [customBreak, setCustomBreak] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mappings, setMappings] = useState<Record<string, any>>({});
    const [xmlCliEnabled, setXmlCliEnabled] = useState(false);

    const loadSettings = async () => {
        if (window.electronAPI.getSpeakerMappings) {
            const m = await window.electronAPI.getSpeakerMappings();
            setMappings(m || {});
        }
        if (window.electronAPI.getXmlCliEnabled) {
            const enabled = await window.electronAPI.getXmlCliEnabled();
            setXmlCliEnabled(enabled);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    // Reload/Sync State
    const [isReloading, setIsReloading] = useState(false);

    const activeSlide = slides[activeSlideIndex] || { src: '', notes: '' };
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


    const handleSectionTextChange = (index: number, value: string) => {
        const sections = parseNotes(activeSlide.notes || '');
        if (!sections[index]) return;
        sections[index].text = value;
        const newNotes = formatNotes(sections);
        
        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newNotes };
        setSlides(newSlides);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            pushToHistory(newSlides);
        }, 800);
    };

    const handleSpeakerChange = (index: number, speaker: string | null) => {
        const sections = parseNotes(activeSlide.notes || '');
        if (!sections[index]) return;
        sections[index].speaker = speaker || '';
        const newNotes = formatNotes(sections);
        
        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newNotes };
        setSlides(newSlides);
        pushToHistory(newSlides);
    };

    const handleAddSection = () => {
        const sections = parseNotes(activeSlide.notes || '');
        sections.push({ speaker: '', text: '' });
        const newNotes = formatNotes(sections);
        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newNotes };
        setSlides(newSlides);
        pushToHistory(newSlides);
        setActiveSectionIndex(sections.length - 1);
    };

    const handleDeleteSection = (index: number) => {
        const sections = parseNotes(activeSlide.notes || '');
        sections.splice(index, 1);
        const newNotes = formatNotes(sections);
        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newNotes };
        setSlides(newSlides);
        pushToHistory(newSlides);
        if (activeSectionIndex >= sections.length) {
            setActiveSectionIndex(Math.max(0, sections.length - 1));
        }
    };

    const insertTag = (startTag: string, endTag: string = '') => {
        const textarea = textareasRefs.current[activeSectionIndex];
        if (!textarea) return;

        const sections = parseNotes(activeSlide.notes || '');
        if (!sections[activeSectionIndex]) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = sections[activeSectionIndex].text || '';

        const before = text.substring(0, start);
        const selection = text.substring(start, end);
        const after = text.substring(end);

        sections[activeSectionIndex].text = before + startTag + selection + endTag + after;
        const newNotes = formatNotes(sections);

        const newSlides = [...slides];
        newSlides[activeSlideIndex] = { ...newSlides[activeSlideIndex], notes: newNotes };

        setSlides(newSlides);
        pushToHistory(newSlides); 

        setTimeout(() => {
            const ta = textareasRefs.current[activeSectionIndex];
            if (ta) {
                ta.focus();
                ta.setSelectionRange(start + startTag.length, end + startTag.length);
            }
        }, 0);
    };

    const handleCustomBreak = () => {
        if (!customBreak) return;
        insertTag(`<break time="${customBreak}"/>`);
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
        if (isInsertingAudio || isSaving || isGenerating || isReloading) return;
        setIsInsertingAudio(true);
        setInsertStatus(`Generating audio for slide ${activeSlide.index}...`);

        try {
            if (ipcRenderer) {
                const slidesAudioString = [];
                if (activeSlide.notes && activeSlide.notes.trim().length > 0) {
                    const sections = parseNotes(activeSlide.notes);
                    for (let i = 0; i < sections.length; i++) {
                        const sec = sections[i];
                        if (sec.text.trim().length > 0) {
                            const urlObj = await getAudioBuffer(sec.text, mappings[sec.speaker] || undefined);
                            slidesAudioString.push({
                                index: activeSlide.index,
                                sectionIndex: i,
                                audioData: new Uint8Array(urlObj)
                            });
                        }
                    }
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
        if (isInsertingAudio || isSaving || isGenerating || isReloading) return;
        setIsInsertingAudio(true);
        setInsertStatus('Generating audio for all slides...');

        try {
            if (ipcRenderer) {
                const slidesAudioString = [];
                for (const slide of slides) {
                    if (slide.notes && slide.notes.trim().length > 0) {
                        setInsertStatus(`Generating audio for slide ${slide.index}...`);
                        const sections = parseNotes(slide.notes);
                        for (let i = 0; i < sections.length; i++) {
                            const sec = sections[i];
                            if (sec.text.trim().length > 0) {
                                const buffer = await getAudioBuffer(sec.text, mappings[sec.speaker] || undefined);
                                slidesAudioString.push({
                                    index: slide.index,
                                    sectionIndex: i,
                                    audioData: new Uint8Array(buffer)
                                });
                            }
                        }
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
        if (isReloading || isSaving || isGenerating) return;

        if (!window.confirm("Syncing will override any unsaved changes in your notes. Do you want to proceed?")) {
            return;
        }

        setIsReloading(true);

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
            setIsReloading(false);
        }
    };

    const handleReloadSlide = async () => {
        if (isReloading || isSaving || isGenerating) return;

        if (!window.confirm("Reloading will override any unsaved changes in your notes. Do you want to proceed?")) {
            return;
        }

        setIsReloading(true);

        try {
            if (ipcRenderer) {
                // Determine 1-based index
                const indexToReload = activeSlide.index || (activeSlideIndex + 1);

                // Call new handler
                const result = await ipcRenderer.invoke('reload-slide', {
                    filePath,
                    slideIndex: indexToReload
                });

                if (result.success && result.slides) {
                    setSlides(result.slides);
                    // Update history to match
                    setHistory([result.slides]);
                    setHistoryIndex(0);
                } else {
                    alert('Reload Slide failed: ' + (result.error || 'Unknown error'));
                }
            }
        } catch (e: any) {
            console.error("Reload slide error:", e);
            alert("Reload slide error: " + e.message);
        } finally {
            setIsReloading(false);
        }
    };

    const [isRemoving, setIsRemoving] = useState(false);
    const [removeStatus, setRemoveStatus] = useState('');

    const handleRemoveAudio = async (scope: 'slide' | 'all') => {
        if (isGenerating || isSaving || isReloading || isRemoving) return;
        setIsRemoving(true);
        setRemoveStatus(scope === 'all' ? 'Removing all audio...' : 'Removing audio...');
        try {
            if (ipcRenderer) {
                const indexToUse = activeSlide.index || (activeSlideIndex + 1);

                const result = await ipcRenderer.invoke('remove-audio', {
                    filePath,
                    scope,
                    slideIndex: indexToUse
                });

                if (result.success) {
                    if (scope === 'all') {
                        alert('Successfully removed audio from all slides.');
                    } else {
                        setRemoveStatus('Removed!');
                        setTimeout(() => setRemoveStatus(''), 2000);
                    }
                } else {
                    alert('Failed to remove audio: ' + (result.error || 'Unknown error'));
                }
            }
        } catch (e: any) {
            console.error("Remove audio error:", e);
            alert("Remove audio error: " + e.message);
        } finally {
            setIsRemoving(false);
            if (removeStatus !== 'Removed!') setRemoveStatus('');
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
                    {(isReloading || isSaving || isInsertingAudio || isGenerating) && (
                        <Group gap="xs" mr="xs">
                            {isReloading && <Text size="xs" c="dimmed">Reloading...</Text>}
                            {isSaving && <Text size="xs" c="dimmed">{saveStatus}</Text>}
                            {isInsertingAudio && <Text size="xs" c="dimmed">{insertStatus}</Text>}
                            {isRemoving && <Text size="xs" c="dimmed">{removeStatus}</Text>}
                            {isGenerating && <Text size="xs" c="dimmed">{genStatus}</Text>}
                        </Group>
                    )}

                    <Button
                        variant="default"
                        size="xs"
                        leftSection={<IconRefresh size={14} className={isReloading ? "mantine-rotate" : ""} />}
                        onClick={handleSyncAll}
                        loading={isReloading}
                        disabled={isGenerating || isSaving || isReloading}
                    >
                        Sync All Slides
                    </Button>

                    <Button
                        variant="filled"
                        color="blue"
                        size="xs"
                        onClick={handleInsertAllAudio}
                        loading={isInsertingAudio}
                        disabled={isGenerating || isSaving || isReloading || isInsertingAudio}
                    >
                        Insert All Audio
                    </Button>

                    <Button
                        variant="default"
                        size="xs"
                        onClick={handleSaveAllNotes}
                        loading={isSaving}
                        disabled={isGenerating || isSaving || isReloading || isInsertingAudio}
                    >
                        Save All Slides
                    </Button>

                    <Button
                        variant="default"
                        size="xs"
                        onClick={() => handleRemoveAudio('all')}
                        loading={isRemoving}
                        disabled={isGenerating || isSaving || isReloading || isRemoving}
                    >
                        Remove All Audio
                    </Button>

                    <Button
                        size="xs"
                        variant="light"
                        color="blue"
                        onClick={handleGenerateVideo}
                        loading={isGenerating}
                        disabled={isGenerating || isSaving || isReloading}
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
                                label="Individual slide reload is disabled in XML mode"
                                disabled={!xmlCliEnabled}
                            >
                                <Button
                                    variant="default"
                                    size="xs"
                                    leftSection={<IconRefresh size={14} className={isReloading ? "mantine-rotate" : ""} />}
                                    onClick={handleReloadSlide}
                                    loading={isReloading}
                                    disabled={isGenerating || isSaving || isReloading || xmlCliEnabled}
                                >
                                    Reload Slide
                                </Button>
                            </Tooltip>

                            <Button
                                variant="filled"
                                color="blue"
                                size="xs"
                                onClick={handleInsertSlideAudio}
                                loading={isInsertingAudio}
                                disabled={isGenerating || isSaving || isReloading || isRemoving || isInsertingAudio}
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
                                    disabled={isGenerating || isSaving || isReloading || isInsertingAudio || xmlCliEnabled}
                                >
                                    Play
                                </Button>
                            </Tooltip>

                            <Button
                                variant="default"
                                size="xs"
                                onClick={handleSaveCurrentSlideNotes}
                                loading={isSaving}
                                disabled={isGenerating || isSaving || isReloading || isRemoving || isInsertingAudio}
                            >
                                Save Slide
                            </Button>

                            <Button
                                variant="default"
                                size="xs"
                                onClick={() => handleRemoveAudio('slide')}
                                loading={isRemoving}
                                disabled={isGenerating || isSaving || isReloading || isRemoving}
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
                                                data={[{value: '', label: 'Default'}].concat(Object.keys(mappings).filter(k => k !== '_default_').map(k => ({ value: k, label: `[${k}]` })))}
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
            <SettingsModal opened={settingsOpen} onClose={() => { setSettingsOpen(false); loadSettings(); }} />
        </div>
    );
}

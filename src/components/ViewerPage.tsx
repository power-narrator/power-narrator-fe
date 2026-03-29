import { Box, Button, Group, Text, Title } from '@mantine/core';
import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import type { Slide } from '../electron';
import { getAudioBuffer } from '../utils/tts';
import { SettingsModal } from './SettingsModal';
import { useSettings } from '../context/useSettings';
import { getErrorMessage } from '../utils/errors';
import { formatNotes, parseNotes, type NoteSection } from '../utils/notes';
import { ViewerHeader } from './viewer/ViewerHeader';
import { SlideThumbnailList } from './viewer/SlideThumbnailList';
import { SlidePreviewPane } from './viewer/SlidePreviewPane';
import { SlideActionsBar } from './viewer/SlideActionsBar';
import { SsmlToolbar } from './viewer/SsmlToolbar';
import { NotesSectionList } from './viewer/NotesSectionList';

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
    const activeSlide = slides[activeSlideIndex] || { index: activeSlideIndex + 1, src: '', notes: '' };
    const activeSections = parseNotes(activeSlide.notes || '');

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
        const newSectionIndex = activeSections.length;
        const newSlides = updateActiveSlideSections((sections) => {
            sections.push({ speaker: '', text: '' });
        });
        pushToHistory(newSlides);
        setActiveSectionIndex(newSectionIndex);
    };

    const handleDeleteSection = (index: number) => {
        const nextSectionCount = Math.max(0, activeSections.length - 1);
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

    const assignTextareaRef = (index: number, element: HTMLTextAreaElement | null) => {
        textareasRefs.current[index] = element;
    };

    const getTextarea = (index: number) => textareasRefs.current[index] || null;

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
            <ViewerHeader
                onBack={onBack}
                onOpenSettings={() => setSettingsOpen(true)}
                onSyncAll={handleSyncAll}
                onInsertAllAudio={handleInsertAllAudio}
                onSaveAllNotes={handleSaveAllNotes}
                onRemoveAllAudio={handleRemoveAllAudio}
                onGenerateVideo={handleGenerateVideo}
                isSyncing={isSyncing}
                isSaving={isSaving}
                isInsertingAudio={isInsertingAudio}
                isRemoving={isRemoving}
                isGenerating={isGenerating}
                busy={busy}
                saveStatus={saveStatus}
                insertStatus={insertStatus}
                removeStatus={removeStatus}
                genStatus={genStatus}
            />

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <SlideThumbnailList
                    slides={slides}
                    activeSlideIndex={activeSlideIndex}
                    onSelectSlide={setActiveSlideIndex}
                />

                <div
                    ref={splitContainerRef}
                    style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--mantine-color-body)' }}
                >
                    <Box
                        style={{
                            height: `${splitRatio}%`,
                            position: 'relative',
                            padding: '1rem',
                            background: 'var(--mantine-color-dark-8)',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <SlidePreviewPane activeSlideSrc={activeSlide.src} />
                    </Box>

                    <div
                        onMouseDown={handleResizeMouseDown}
                        style={{
                            height: '6px',
                            background: 'var(--mantine-color-dark-4)',
                            cursor: 'ns-resize',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10,
                        }}
                    >
                        <div style={{ width: 30, height: 2, background: 'var(--mantine-color-dimmed)', borderRadius: 1 }} />
                    </div>

                    <Box style={{ flex: 1, height: `${100 - splitRatio}%`, padding: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <SlideActionsBar
                            busy={busy}
                            xmlCliEnabled={xmlCliEnabled}
                            isSyncing={isSyncing}
                            isInsertingAudio={isInsertingAudio}
                            isSaving={isSaving}
                            isRemoving={isRemoving}
                            removeStatus={removeStatus}
                            onSyncSlide={handleSyncSlide}
                            onInsertSlideAudio={handleInsertSlideAudio}
                            onPlaySlide={handlePlaySlide}
                            onSaveCurrentSlideNotes={handleSaveCurrentSlideNotes}
                            onRemoveSlideAudio={handleRemoveSlideAudio}
                        />

                        <SsmlToolbar
                            historyIndex={historyIndex}
                            historyLength={history.length}
                            customBreak={customBreak}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                            onCustomBreakChange={setCustomBreak}
                            onSubmitCustomBreak={handleCustomBreak}
                            onInsertSelfClosingTag={insertSelfClosingTag}
                            onInsertWrappedTag={insertWrappedTag}
                        />

                        <NotesSectionList
                            sections={activeSections}
                            mappings={mappings}
                            onFocusSection={setActiveSectionIndex}
                            onSpeakerChange={handleSpeakerChange}
                            onSectionTextChange={handleSectionTextChange}
                            onDeleteSection={handleDeleteSection}
                            onAddSection={handleAddSection}
                            assignTextareaRef={assignTextareaRef}
                            getTextarea={getTextarea}
                        />
                    </Box>
                </div>
            </div>
            <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
    );
}

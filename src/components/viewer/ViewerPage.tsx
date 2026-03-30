import { Box, Button, Group, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Slide, SlideAudioEntry, SlidesElectronResult } from "../../types/electron";
import { useSettings } from "../../context/useSettings";
import { getErrorMessage } from "../../utils/errors";
import type { NoteSection } from "../../types/notes";
import { formatNotes, parseNotes } from "../../utils/notes";
import { getAudioBuffer } from "../../utils/tts";
import { SettingsModal } from "../settings/SettingsModal";
import { NotesSectionList } from "./NotesSectionList";
import { SlideActionsBar } from "./SlideActionsBar";
import { SlidePreviewPane } from "./SlidePreviewPane";
import { SlideThumbnailList } from "./SlideThumbnailList";
import { SsmlToolbar } from "./SsmlToolbar";
import { ViewerHeader } from "./ViewerHeader";

interface ViewerPageProps {
  slides: Slide[];
  filePath: string;
  onBack: () => void;
}

const EMPTY_SLIDE: Slide = {
  index: 1,
  image: "",
  src: "",
  notes: "",
};

function getSlideNumber(slide: Slide, fallbackIndex: number) {
  return slide.index || fallbackIndex + 1;
}

export function ViewerPage({ slides: initialSlides, filePath, onBack }: ViewerPageProps) {
  const [slides, setSlides] = useState<Slide[]>(initialSlides);
  const [history, setHistory] = useState<Slide[][]>([initialSlides]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [customBreak, setCustomBreak] = useState("");
  const [splitRatio, setSplitRatio] = useState(40);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [isInsertingAudio, setIsInsertingAudio] = useState(false);
  const [insertStatus, setInsertStatus] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeStatus, setRemoveStatus] = useState("");

  const textareasRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelectionRef = useRef<{ sectionIndex: number; start: number; end: number } | null>(
    null,
  );
  const statusTimeoutsRef = useRef<number[]>([]);
  const { mappings, xmlCliEnabled } = useSettings();
  const electronAPI = window.electronAPI;

  const activeSlide = slides[activeSlideIndex] ?? { ...EMPTY_SLIDE, index: activeSlideIndex + 1 };
  const activeSections = parseNotes(activeSlide.notes || "");
  const busy = isGenerating || isSaving || isSyncing || isInsertingAudio || isRemoving;

  function clearDebounce() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function scheduleStatusClear(setter: (value: string) => void, delay = 2000) {
    const timeoutId = window.setTimeout(() => setter(""), delay);
    statusTimeoutsRef.current.push(timeoutId);
  }

  function alertError(label: string, error: unknown) {
    const message = getErrorMessage(error);
    console.error(`${label}:`, error);
    alert(`${label}: ${message}`);
  }

  function pushToHistory(nextSlides: Slide[]) {
    const nextHistoryIndex = historyIndexRef.current + 1;
    setHistory((previousHistory) => [...previousHistory.slice(0, nextHistoryIndex), nextSlides]);
    historyIndexRef.current = nextHistoryIndex;
    setHistoryIndex(nextHistoryIndex);
  }

  function updateActiveSlideSections(updater: (sections: NoteSection[]) => void) {
    const sections = parseNotes(activeSlide.notes || "");
    updater(sections);

    const nextSlides = [...slides];
    nextSlides[activeSlideIndex] = {
      ...nextSlides[activeSlideIndex],
      notes: formatNotes(sections),
    };

    setSlides(nextSlides);
    return nextSlides;
  }

  function resetHistoryWithSlides(nextSlides: Slide[]) {
    setSlides(nextSlides);
    setHistory([nextSlides]);
    historyIndexRef.current = 0;
    setHistoryIndex(0);
  }

  async function saveNotesToFile(slidesToSave: Slide[]) {
    const result = await electronAPI.saveAllNotes(filePath, slidesToSave);
    if (!result.success) {
      throw new Error(result.error || "Save failed");
    }

    return result;
  }

  async function buildSlideAudioEntries(
    slidesToProcess: Slide[],
    onProgress: (message: string) => void,
  ) {
    const audioEntries: SlideAudioEntry[] = [];

    for (const slide of slidesToProcess) {
      if (!slide.notes?.trim()) {
        continue;
      }

      onProgress(`Generating audio for slide ${slide.index}...`);
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

  function runRemoveAudio(scope: "slide" | "all") {
    const slideIndex = getSlideNumber(activeSlide, activeSlideIndex);
    return electronAPI.removeAudio({ filePath, scope, slideIndex });
  }

  useEffect(() => {
    setSlides(initialSlides);
    setHistory([initialSlides]);
    historyIndexRef.current = 0;
    setHistoryIndex(0);
    setActiveSlideIndex(0);
    setActiveSectionIndex(0);
  }, [initialSlides]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    setActiveSectionIndex(0);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [activeSlideIndex]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      statusTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    },
    [],
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current === 0) {
      return;
    }

    const nextHistoryIndex = historyIndexRef.current - 1;
    historyIndexRef.current = nextHistoryIndex;
    setHistoryIndex(nextHistoryIndex);
    setSlides(history[nextHistoryIndex]);
  }, [history]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= history.length - 1) {
      return;
    }

    const nextHistoryIndex = historyIndexRef.current + 1;
    historyIndexRef.current = nextHistoryIndex;
    setHistoryIndex(nextHistoryIndex);
    setSlides(history[nextHistoryIndex]);
  }, [history]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "z") {
        event.preventDefault();
        handleUndo();
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "y") {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRedo, handleUndo]);

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
  }, [activeSectionIndex, activeSlide.notes]);

  function insertWrappedTag(startTag: string, endTag = "") {
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

      const text = activeSection.text || "";
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

  const handleSectionTextChange = (index: number, value: string) => {
    const nextSlides = updateActiveSlideSections((sections) => {
      if (sections[index]) {
        sections[index].text = value;
      }
    });

    clearDebounce();
    debounceRef.current = setTimeout(() => {
      pushToHistory(nextSlides);
      debounceRef.current = null;
    }, 800);
  };

  const handleSpeakerChange = (index: number, speaker: string | null) => {
    const nextSlides = updateActiveSlideSections((sections) => {
      if (sections[index]) {
        sections[index].speaker = speaker || "";
      }
    });
    pushToHistory(nextSlides);
  };

  const handleAddSection = () => {
    const newSectionIndex = activeSections.length;
    const nextSlides = updateActiveSlideSections((sections) => {
      sections.push({ speaker: "", text: "" });
    });
    pushToHistory(nextSlides);
    setActiveSectionIndex(newSectionIndex);
  };

  const handleDeleteSection = (index: number) => {
    const nextSectionCount = Math.max(0, activeSections.length - 1);
    const nextSlides = updateActiveSlideSections((sections) => {
      sections.splice(index, 1);
    });
    pushToHistory(nextSlides);

    if (activeSectionIndex >= nextSectionCount) {
      setActiveSectionIndex(Math.max(0, nextSectionCount - 1));
    }
  };

  const assignTextareaRef = (index: number, element: HTMLTextAreaElement | null) => {
    textareasRefs.current[index] = element;
  };

  const getTextarea = (index: number) => textareasRefs.current[index] || null;

  const handleResizeMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startSplit = splitRatio;
    const containerHeight = splitContainerRef.current?.clientHeight || 1;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaPercentage = (deltaY / containerHeight) * 100;
      const nextSplit = Math.min(Math.max(startSplit + deltaPercentage, 20), 80);
      setSplitRatio(nextSplit);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleGenerateVideo = async () => {
    if (isGenerating) {
      return;
    }

    try {
      setGenStatus("Saving notes...");
      await saveNotesToFile(slides);

      const savePath = await electronAPI.getVideoSavePath();
      if (!savePath) {
        setGenStatus("");
        return;
      }

      setIsGenerating(true);
      setGenStatus("Preparing audio...");

      const slidesAudio: SlideAudioEntry[] = [];
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

      setGenStatus("Rendering video (this may take a while)...");
      const result = await electronAPI.generateVideo({
        filePath,
        slidesAudio,
        videoOutputPath: savePath,
      });

      if (result.success) {
        alert(`Video generated successfully at: ${result.outputPath}`);
      } else {
        alert(`Video generation failed: ${result.error}`);
      }
    } catch (error: unknown) {
      alertError("Error preparing generation", error);
    } finally {
      setIsGenerating(false);
      setGenStatus("");
    }
  };

  const handleSaveAllNotes = async () => {
    if (isSaving || isInsertingAudio) {
      return;
    }

    setIsSaving(true);
    setSaveStatus("Saving all notes...");

    try {
      await saveNotesToFile(slides);
      alert("Notes saved successfully!");
    } catch (error: unknown) {
      alertError("Save error", error);
    } finally {
      setIsSaving(false);
      setSaveStatus("");
    }
  };

  const handleSaveCurrentSlideNotes = async () => {
    if (isSaving || isInsertingAudio) {
      return;
    }

    setIsSaving(true);
    setSaveStatus(`Saving Note for Slide ${activeSlide.index}...`);

    try {
      await saveNotesToFile([activeSlide]);
      setSaveStatus("Saved!");
      scheduleStatusClear(setSaveStatus);
    } catch (error: unknown) {
      alertError("Save error", error);
      setSaveStatus("");
    } finally {
      setIsSaving(false);
    }
  };

  const handleInsertSlideAudio = async () => {
    if (isInsertingAudio || isSaving || isGenerating || isSyncing) {
      return;
    }

    setIsInsertingAudio(true);
    setInsertStatus(`Generating audio for slide ${activeSlide.index}...`);

    try {
      const slidesAudio = await buildSlideAudioEntries([activeSlide], setInsertStatus);
      if (slidesAudio.length === 0) {
        alert("No notes found to generate audio.");
        setInsertStatus("");
        return;
      }

      setInsertStatus("Inserting audio...");
      const result = await electronAPI.insertAudio(filePath, slidesAudio);

      if (!result.success) {
        alert(`Failed to insert audio: ${result.error}`);
        setInsertStatus("");
        return;
      }

      setInsertStatus("Audio Inserted!");
      scheduleStatusClear(setInsertStatus);
    } catch (error: unknown) {
      alertError("Insert error", error);
      setInsertStatus("");
    } finally {
      setIsInsertingAudio(false);
    }
  };

  const handleInsertAllAudio = async () => {
    if (isInsertingAudio || isSaving || isGenerating || isSyncing) {
      return;
    }

    setIsInsertingAudio(true);
    setInsertStatus("Generating audio for all slides...");

    try {
      const slidesAudio = await buildSlideAudioEntries(slides, setInsertStatus);
      if (slidesAudio.length === 0) {
        alert("No notes found to generate audio.");
        setInsertStatus("");
        return;
      }

      setInsertStatus("Inserting all audio...");
      const result = await electronAPI.insertAudio(filePath, slidesAudio);

      if (result.success) {
        alert("All audio inserted successfully!");
      } else {
        alert(`Failed to insert audio: ${result.error}`);
      }
    } catch (error: unknown) {
      alertError("Insert error", error);
    } finally {
      setIsInsertingAudio(false);
      setInsertStatus("");
    }
  };

  const handlePlaySlide = async () => {
    try {
      const result = await electronAPI.playSlide(getSlideNumber(activeSlide, activeSlideIndex));
      if (!result.success) {
        alert(`Failed to play slide: ${result.error}`);
      }
    } catch (error: unknown) {
      alertError("Play slide error", error);
    }
  };

  const confirmSync = () =>
    window.confirm(
      "Syncing will override any unsaved changes in your notes. Do you want to proceed?",
    );

  const syncSlides = async (request: Promise<SlidesElectronResult>, failureMessage: string) => {
    if (!confirmSync()) {
      return;
    }

    setIsSyncing(true);

    try {
      const result = await request;
      if (!result.success || !result.slides) {
        alert(`${failureMessage}: ${result.error || "Unknown error"}`);
        return;
      }

      resetHistoryWithSlides(result.slides);
      setActiveSlideIndex((currentIndex) =>
        Math.min(currentIndex, Math.max(0, result.slides!.length - 1)),
      );
    } catch (error: unknown) {
      alertError(failureMessage, error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    if (isSyncing || isSaving || isGenerating) {
      return;
    }

    await syncSlides(electronAPI.convertPptx(filePath), "Sync error");
  };

  const handleSyncSlide = async () => {
    if (isSyncing || isSaving || isGenerating) {
      return;
    }

    await syncSlides(
      electronAPI.syncSlide({
        filePath,
        slideIndex: getSlideNumber(activeSlide, activeSlideIndex),
      }),
      "Sync slide error",
    );
  };

  const handleRemoveSlideAudio = async () => {
    if (isGenerating || isSaving || isSyncing || isRemoving) {
      return;
    }

    setIsRemoving(true);
    setRemoveStatus("Removing audio...");

    try {
      const result = await runRemoveAudio("slide");
      if (!result.success) {
        alert(`Failed to remove audio: ${result.error || "Unknown error"}`);
        setRemoveStatus("");
        return;
      }

      setRemoveStatus("Removed!");
      scheduleStatusClear(setRemoveStatus);
    } catch (error: unknown) {
      alertError("Remove audio error", error);
      setRemoveStatus("");
    } finally {
      setIsRemoving(false);
    }
  };

  const handleRemoveAllAudio = async () => {
    if (isGenerating || isSaving || isSyncing || isRemoving) {
      return;
    }

    setIsRemoving(true);
    setRemoveStatus("Removing all audio...");

    try {
      const result = await runRemoveAudio("all");
      if (result.success) {
        alert("Successfully removed audio from all slides.");
      } else {
        alert(`Failed to remove audio: ${result.error || "Unknown error"}`);
      }
    } catch (error: unknown) {
      alertError("Remove audio error", error);
    } finally {
      setIsRemoving(false);
      setRemoveStatus("");
    }
  };

  if (!electronAPI) {
    return (
      <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
        <Group
          justify="space-between"
          p="xs"
          style={{
            borderBottom: "1px solid var(--mantine-color-dark-4)",
            background: "var(--mantine-color-dark-7)",
          }}
        >
          <Button variant="subtle" size="xs" onClick={onBack}>
            &larr; Back
          </Button>
          <Title order={5}>Viewer</Title>
          <div />
        </Group>
        <Box p="xl">
          <Text c="red" fw={600} mb="sm">
            Electron preload API is unavailable.
          </Text>
          <Text size="sm" c="dimmed">
            Please run this app inside the Electron desktop shell to use viewer actions.
          </Text>
        </Box>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <SlideThumbnailList
          slides={slides}
          activeSlideIndex={activeSlideIndex}
          onSelectSlide={setActiveSlideIndex}
        />

        <div
          ref={splitContainerRef}
          style={{
            flex: 1,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "var(--mantine-color-body)",
          }}
        >
          <Box
            style={{
              height: `${splitRatio}%`,
              position: "relative",
              padding: "1rem",
              background: "var(--mantine-color-dark-8)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SlidePreviewPane activeSlideSrc={activeSlide.src} />
          </Box>

          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              height: "6px",
              background: "var(--mantine-color-dark-4)",
              cursor: "ns-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 30,
                height: 2,
                background: "var(--mantine-color-dimmed)",
                borderRadius: 1,
              }}
            />
          </div>

          <Box
            style={{
              flex: 1,
              height: `${100 - splitRatio}%`,
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
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
              onUndo={handleUndo}
              onRedo={handleRedo}
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

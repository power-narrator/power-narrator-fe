import { Stack } from "@mantine/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActionButtonState } from "../../types/viewer";
import type { Slide, SlidesElectronResult } from "../../types/electron";
import { useSettings } from "../../context/useSettings";
import { getErrorMessage } from "../../utils/errors";
import type { NoteSection } from "../../types/notes";
import { formatNotes, parseNotes } from "../../utils/notes";
import { getAudioBuffer } from "../../utils/tts";
import { NotesSectionList } from "./NotesSectionList";
import { SlideActionsBar, type SlideActionBarKey } from "./SlideActionsBar";
import { SlidePreviewPane } from "./SlidePreviewPane";
import { SlideThumbnailList } from "./SlideThumbnailList";
import { SsmlToolbar } from "./SsmlToolbar";
import { ViewerHeader, type ViewerHeaderActionKey } from "./ViewerHeader";
import { Split } from "@gfazioli/mantine-split-pane";

interface ViewerPageProps {
  slides: Slide[];
  filePath: string;
  onBack: () => void;
  onOpenSettings: () => void;
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

export function ViewerPage({
  slides: initialSlides,
  filePath,
  onBack,
  onOpenSettings,
}: ViewerPageProps) {
  const [slides, setSlides] = useState<Slide[]>(initialSlides);
  const [history, setHistory] = useState<Slide[][]>([initialSlides]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [isInsertingAudio, setIsInsertingAudio] = useState(false);
  const [insertStatus, setInsertStatus] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeStatus, setRemoveStatus] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playStatus, setPlayStatus] = useState("");

  const textareasRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelectionRef = useRef<{ sectionIndex: number; start: number; end: number } | null>(
    null,
  );
  const statusTimeoutsRef = useRef<number[]>([]);
  const { mappings, xmlCliEnabled } = useSettings();
  const electronAPI = window.electronAPI;
  const busy = isGenerating || isSaving || isSyncing || isInsertingAudio || isRemoving || isPlaying;
  const busyOrXml = busy || xmlCliEnabled;

  const headerActionStates: Record<ViewerHeaderActionKey, ActionButtonState> = {
    reloadAllSlides: { loading: isSyncing, busy: busy && !isSyncing, status: syncStatus },
    saveAllAudioAndNotes: {
      loading: isSaving || isInsertingAudio,
      busy: (busy && !isSaving && !isInsertingAudio) || isSaving || isInsertingAudio,
      status: saveStatus || insertStatus,
    },
    removeAllAudio: { loading: isRemoving, busy: busy && !isRemoving, status: removeStatus },
    generateVideo: { loading: isGenerating, busy: busyOrXml && !isGenerating, status: genStatus },
  };

  const slideActionStates: Record<SlideActionBarKey, ActionButtonState> = {
    reloadSlide: { loading: isSyncing, busy: busy && !isSyncing, status: syncStatus },
    saveAudioAndNotes: {
      loading: isSaving || isInsertingAudio,
      busy: (busy && !isSaving && !isInsertingAudio) || isSaving || isInsertingAudio,
      status: saveStatus || insertStatus,
    },
    playSlide: { loading: isPlaying, busy: busyOrXml && !isPlaying, status: playStatus },
    removeAudio: { loading: isRemoving, busy: busy && !isRemoving, status: removeStatus },
  };

  const activeSlide = slides[activeSlideIndex] ?? { ...EMPTY_SLIDE, index: activeSlideIndex + 1 };
  const activeSections = parseNotes(activeSlide.notes || "");

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
    const result = await electronAPI.saveNotes(filePath, slidesToSave);
    if (!result.success) {
      throw new Error(result.message);
    }

    return result;
  }

  async function buildSlideAudioEntries(
    slidesToProcess: Slide[],
    onProgress: (message: string) => void,
  ) {
    const slideAudioGroups = await Promise.all(
      slidesToProcess.map(async (slide) => {
        if (!slide.notes?.trim()) {
          return [];
        }

        onProgress(`Generating audio for slide ${slide.index}...`);
        const sections = parseNotes(slide.notes);
        const sectionAudioEntries = await Promise.all(
          sections.map(async (section, sectionIndex) => {
            if (!section.text.trim()) {
              return null;
            }

            const buffer = await getAudioBuffer(
              section.text,
              mappings[section.speaker] || undefined,
            );
            return {
              index: slide.index,
              sectionIndex,
              audioData: new Uint8Array(buffer),
            };
          }),
        );

        return sectionAudioEntries.filter((entry) => entry !== null);
      }),
    );

    return slideAudioGroups.flat();
  }

  function runRemoveAudio(slideIndices: number[]) {
    return electronAPI.removeAudio({ filePath, slideIndices });
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

  const handleGenerateVideo = async () => {
    if (busy) {
      return;
    }

    try {
      setIsGenerating(true);
      setGenStatus("Saving notes...");
      await saveNotesToFile(slides);

      const savePath = await electronAPI.getVideoSavePath();
      if (!savePath) {
        setIsGenerating(false);
        setGenStatus("");
        return;
      }

      setGenStatus("Preparing audio...");

      setGenStatus("Rendering video...");
      const result = await electronAPI.generateVideo({
        filePath,
        videoOutputPath: savePath,
      });

      if (result.success) {
        alert(`Video generated successfully at: ${result.outputPath}`);
        setGenStatus("Generated!");
        scheduleStatusClear(setGenStatus);
      } else {
        alert(`Video generation failed: ${result.message}`);
        setGenStatus("");
      }
    } catch (error: unknown) {
      alertError("Error preparing generation", error);
      setGenStatus("");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAudioAndNotes = async () => {
    if (busy) {
      return;
    }

    setIsSaving(true);
    setSaveStatus(`Saving slide ${activeSlide.index}...`);

    try {
      await saveNotesToFile([activeSlide]);
      setSaveStatus("Saved!");
    } catch (error: unknown) {
      alertError("Save error", error);
      setSaveStatus("");
      return;
    } finally {
      setIsSaving(false);
    }

    setSaveStatus("");
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
        alert(`Failed to insert audio: ${result.message}`);
        setInsertStatus("");
        return;
      }

      setInsertStatus("Inserted!");
      scheduleStatusClear(setInsertStatus);
    } catch (error: unknown) {
      alertError("Insert error", error);
      setInsertStatus("");
    } finally {
      setIsInsertingAudio(false);
    }
  };

  const handleSaveAllAudioAndNotes = async () => {
    if (busy) {
      return;
    }

    setIsSaving(true);
    setSaveStatus("Saving all notes...");

    try {
      await saveNotesToFile(slides);
      alert("Notes saved successfully!");
      setSaveStatus("Saved!");
    } catch (error: unknown) {
      alertError("Save error", error);
      setSaveStatus("");
      return;
    } finally {
      setIsSaving(false);
    }

    setSaveStatus("");
    setIsInsertingAudio(true);
    setInsertStatus("Generating all audio...");

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
        setInsertStatus("Inserted!");
        scheduleStatusClear(setInsertStatus);
      } else {
        alert(`Failed to insert audio: ${result.message}`);
        setInsertStatus("");
      }
    } catch (error: unknown) {
      alertError("Insert error", error);
      setInsertStatus("");
    } finally {
      setIsInsertingAudio(false);
    }
  };

  const handlePlaySlide = async () => {
    if (busy) {
      return;
    }

    try {
      setIsPlaying(true);
      setPlayStatus(`Playing slide ${activeSlide.index}...`);
      const result = await electronAPI.playSlide({
        filePath,
        slideIndex: getSlideNumber(activeSlide, activeSlideIndex),
      });
      if (!result.success) {
        alert(`Failed to play slide: ${result.message}`);
        setPlayStatus("");
        return;
      }

      setPlayStatus("Played");
      scheduleStatusClear(setPlayStatus, 1200);
    } catch (error: unknown) {
      alertError("Play slide error", error);
      setPlayStatus("");
    } finally {
      setIsPlaying(false);
    }
  };

  const confirmSync = () =>
    window.confirm(
      "Syncing will override any unsaved changes in your notes. Do you want to proceed?",
    );

  const syncSlides = async (
    request: Promise<SlidesElectronResult>,
    failureMessage: string,
    progressMessage: string,
  ) => {
    if (!confirmSync()) {
      return;
    }

    setIsSyncing(true);
    setSyncStatus(progressMessage);

    try {
      const result = await request;
      if (!result.success) {
        alert(`${failureMessage}: ${result.message}`);
        setSyncStatus("");
        return;
      }

      resetHistoryWithSlides(result.slides);
      setActiveSlideIndex((currentIndex) =>
        Math.min(currentIndex, Math.max(0, result.slides!.length - 1)),
      );
      setSyncStatus("Synced!");
      scheduleStatusClear(setSyncStatus);
    } catch (error: unknown) {
      alertError(failureMessage, error);
      setSyncStatus("");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReloadAllSlides = async () => {
    if (busy) {
      return;
    }

    await syncSlides(electronAPI.convertPptx(filePath), "Sync error", "Syncing all slides...");
  };

  const handleReloadSlide = async () => {
    if (busy) {
      return;
    }

    await syncSlides(
      electronAPI.reloadSlide({
        filePath,
        slideIndex: getSlideNumber(activeSlide, activeSlideIndex),
      }),
      "Sync slide error",
      `Syncing slide ${activeSlide.index}...`,
    );
  };

  const handleRemoveAudio = async () => {
    if (busy) {
      return;
    }

    setIsRemoving(true);
    setRemoveStatus("Removing audio...");

    try {
      const result = await runRemoveAudio([getSlideNumber(activeSlide, activeSlideIndex)]);
      if (!result.success) {
        alert(`Failed to remove audio: ${result.message}`);
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
    if (busy) {
      return;
    }

    setIsRemoving(true);
    setRemoveStatus("Removing all audio...");

    try {
      const result = await runRemoveAudio(slides.map((slide) => slide.index));
      if (result.success) {
        alert("Successfully removed audio from all slides.");
        setRemoveStatus("Removed!");
        scheduleStatusClear(setRemoveStatus);
      } else {
        alert(`Failed to remove audio: ${result.message}`);
        setRemoveStatus("");
      }
    } catch (error: unknown) {
      alertError("Remove audio error", error);
      setRemoveStatus("");
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Stack gap="0" h="100%" mih={0}>
      <ViewerHeader
        onBack={onBack}
        onOpenSettings={onOpenSettings}
        actionStates={headerActionStates}
        handlers={{
          reloadAllSlides: handleReloadAllSlides,
          saveAllAudioAndNotes: handleSaveAllAudioAndNotes,
          removeAllAudio: handleRemoveAllAudio,
          generateVideo: handleGenerateVideo,
        }}
      />

      <Split mih={0} flex={1}>
        <Split.Pane initialWidth="10%">
          <SlideThumbnailList
            slides={slides}
            activeSlideIndex={activeSlideIndex}
            onSelectSlide={setActiveSlideIndex}
          />
        </Split.Pane>

        <Split.Resizer />

        <Split.Pane grow>
          <Split orientation="horizontal" h="100%">
            <Split.Pane initialHeight="30%">
              <SlidePreviewPane activeSlideSrc={activeSlide.src} />
            </Split.Pane>

            <Split.Resizer />

            <Split.Pane grow>
              <Stack p="md" h="100%">
                <SlideActionsBar
                  actionStates={slideActionStates}
                  handlers={{
                    reloadSlide: handleReloadSlide,
                    saveAudioAndNotes: handleSaveAudioAndNotes,
                    playSlide: handlePlaySlide,
                    removeAudio: handleRemoveAudio,
                  }}
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
                  slideIndex={activeSlide.index}
                  onFocusSection={setActiveSectionIndex}
                  onSpeakerChange={handleSpeakerChange}
                  onSectionTextChange={handleSectionTextChange}
                  onDeleteSection={handleDeleteSection}
                  onAddSection={handleAddSection}
                  assignTextareaRef={assignTextareaRef}
                  getTextarea={getTextarea}
                />
              </Stack>
            </Split.Pane>
          </Split>
        </Split.Pane>
      </Split>
    </Stack>
  );
}

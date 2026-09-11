import { Stack } from "@mantine/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ActionButtonState } from "../../types/viewer";
import type { Slide, SlideElectronResult } from "../../types/electron";
import { useSettings } from "../../context/useSettings";
import { getErrorMessage } from "../../utils/errors";
import {
  formatNarrationSections,
  parseNarrationSections,
  type NarrationSection,
} from "../../../electron/narration/NarrationSections";
import { NotesSectionList } from "./NotesSectionList";
import { SlideActionsBar, type SlideActionBarKey } from "./SlideActionsBar";
import { SlidePreviewPane } from "./SlidePreviewPane";
import { SlideThumbnailList } from "./SlideThumbnailList";
import { SsmlToolbar } from "./SsmlToolbar";
import { ViewerHeader, type ViewerHeaderActionKey } from "./ViewerHeader";
import { Split } from "@gfazioli/mantine-split-pane";
import { useViewerSession } from "./useViewerSession";
import type { SavedSlideSelection } from "./ViewerSession";
import { useViewerOperation } from "./useViewerOperation";

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

export function ViewerPage({
  slides: initialSlides,
  filePath,
  onBack,
  onOpenSettings,
}: ViewerPageProps) {
  const electronAPI = window.electronAPI;
  const reportUnsavedChanges = useCallback(
    (hasUnsavedChanges: boolean) => electronAPI.setHasUnsavedNarrationChanges(hasUnsavedChanges),
    [electronAPI],
  );
  const viewerSession = useViewerSession(initialSlides, reportUnsavedChanges);
  const slides = viewerSession.slides;
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const operation = useViewerOperation();

  const textareasRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelectionRef = useRef<{ sectionIndex: number; start: number; end: number } | null>(
    null,
  );
  const { mappings } = useSettings();
  const busy = operation.busy;

  const headerActionStates: Record<ViewerHeaderActionKey, ActionButtonState> = {
    reloadAllSlides: operation.actionState("reloadAllSlides"),
    saveAllSlides: operation.actionState("saveAllSlides"),
    removeAllAudio: operation.actionState("removeAllAudio"),
    generateVideo: operation.actionState("generateVideo"),
  };

  const slideActionStates: Record<SlideActionBarKey, ActionButtonState> = {
    reloadSlide: operation.actionState("reloadSlide"),
    saveSlide: operation.actionState("saveSlide"),
    playSlide: operation.actionState("playSlide"),
    removeAudio: operation.actionState("removeAudio"),
  };

  const activeSlide = slides[activeSlideIndex] ?? { ...EMPTY_SLIDE, index: activeSlideIndex + 1 };
  const activeSlideNumber = activeSlide.index || activeSlideIndex + 1;
  const activeSections = parseNarrationSections(activeSlide.notes || "");

  function clearDebounce() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function alertError(label: string, error: unknown) {
    const message = getErrorMessage(error);
    console.error(`${label}:`, error);
    alert(`${label}: ${message}`);
  }

  function reportNarratedSaveFailure(result: { partial: boolean; message: string }) {
    const partialMessage = result.partial
      ? "PowerPoint notes were saved, but narration audio was not committed."
      : result.message;
    alert(`Save error: ${partialMessage}${result.partial ? ` ${result.message}` : ""}`);
  }

  function pushToHistory(nextSlides: Slide[], changedSlidePositions: readonly number[]) {
    viewerSession.commitSlides(nextSlides, changedSlidePositions);
  }

  async function confirmDiscardChanges(slideIndices?: readonly number[]) {
    return (
      !viewerSession.wouldDiscard(slideIndices) || electronAPI.confirmDiscardNarrationChanges()
    );
  }

  function setEditedSlides(nextSlides: Slide[], changedSlidePositions: readonly number[]) {
    viewerSession.updateSlides(nextSlides, changedSlidePositions);
  }

  function markSlidesFullySaved(savedSlides: SavedSlideSelection[]) {
    viewerSession.saveCompleted(savedSlides);
  }

  function updateActiveSlideSections(updater: (sections: NarrationSection[]) => boolean) {
    const currentSlide = slides[activeSlideIndex];
    if (!currentSlide) {
      return undefined;
    }

    const sections = parseNarrationSections(currentSlide.notes || "");
    if (!updater(sections)) {
      return undefined;
    }

    const nextSlides = [...slides];
    nextSlides[activeSlideIndex] = {
      ...currentSlide,
      notes: formatNarrationSections(sections),
    };

    setEditedSlides(nextSlides, [activeSlideIndex]);
    return nextSlides;
  }

  function resetHistoryWithSlides(nextSlides: Slide[], reloadedSlides = nextSlides) {
    const reloadedPositions =
      reloadedSlides === nextSlides
        ? undefined
        : reloadedSlides.flatMap((reloadedSlide) => {
            const position = nextSlides.findIndex((slide) => slide.index === reloadedSlide.index);
            return position === -1 ? [] : [position];
          });
    viewerSession.reloadCompleted(nextSlides, reloadedPositions);
  }

  /**
   * Commits the whole presentation through the narrated save path, so notes and
   * narration audio are validated, synthesized, and committed together.
   */
  async function commitNarratedPresentation(setStatus: (status: string) => void) {
    const result = await electronAPI.saveNarratedPresentation(
      {
        filePath,
        slides: slides.map((slide) => ({
          slideIndex: slide.index,
          notes: slide.notes || "",
        })),
      },
      ({ completed, total }) => setStatus(`Preparing narration ${completed}/${total}...`),
    );
    if (!result.success) {
      reportNarratedSaveFailure(result);
      return false;
    }

    markSlidesFullySaved(slides.map((slide, position) => ({ slide, position })));
    return true;
  }

  function runRemoveAudio(slideIndices: number[]) {
    return electronAPI.removeAudio({ filePath, slideIndices });
  }

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
    },
    [],
  );

  const handleUndo = () => {
    viewerSession.undo();
  };

  const handleRedo = () => {
    viewerSession.redo();
  };

  function handleHistoryKeyDown(event: ReactKeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      event.preventDefault();
      handleUndo();
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "y") {
      event.preventDefault();
      handleRedo();
    }
  }

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
        return false;
      }

      const text = activeSection.text || "";
      const before = text.substring(0, selectionStart);
      const selection = text.substring(selectionStart, selectionEnd);
      const after = text.substring(selectionEnd);
      activeSection.text = before + startTag + selection + endTag + after;
      return true;
    });

    if (!nextSlides) {
      return;
    }

    pendingSelectionRef.current = {
      sectionIndex: activeSectionIndex,
      start: selectionStart + startTag.length,
      end: selectionEnd + startTag.length,
    };

    pushToHistory(nextSlides, [activeSlideIndex]);
  }

  function insertSelfClosingTag(tag: string) {
    insertWrappedTag(tag);
  }

  const handleSectionTextChange = (index: number, value: string) => {
    const nextSlides = updateActiveSlideSections((sections) => {
      const section = sections[index];
      if (!section) {
        return false;
      }

      section.text = value;
      return true;
    });

    if (!nextSlides) {
      return;
    }

    clearDebounce();
    debounceRef.current = setTimeout(() => {
      pushToHistory(nextSlides, [activeSlideIndex]);
      debounceRef.current = null;
    }, 800);
  };

  const handleSpeakerChange = (index: number, speaker: string | null) => {
    const nextSlides = updateActiveSlideSections((sections) => {
      const section = sections[index];
      if (!section) {
        return false;
      }

      section.speaker = speaker || "";
      return true;
    });

    if (!nextSlides) {
      return;
    }

    pushToHistory(nextSlides, [activeSlideIndex]);
  };

  const handleAddSection = () => {
    const newSectionIndex = activeSections.length;
    const nextSlides = updateActiveSlideSections((sections) => {
      sections.push({ speaker: "", text: "" });
      return true;
    });

    if (!nextSlides) {
      return;
    }

    pushToHistory(nextSlides, [activeSlideIndex]);
    setActiveSectionIndex(newSectionIndex);
  };

  const handleDeleteSection = (index: number) => {
    const nextSectionCount = Math.max(0, activeSections.length - 1);
    const nextSlides = updateActiveSlideSections((sections) => {
      if (!sections[index]) {
        return false;
      }

      sections.splice(index, 1);
      return true;
    });

    if (!nextSlides) {
      return;
    }

    pushToHistory(nextSlides, [activeSlideIndex]);

    if (activeSectionIndex >= nextSectionCount) {
      setActiveSectionIndex(Math.max(0, nextSectionCount - 1));
    }
  };

  const assignTextareaRef = (index: number, element: HTMLTextAreaElement | null) => {
    textareasRefs.current[index] = element;
  };

  const getTextarea = (index: number) => textareasRefs.current[index] || null;

  const handleGenerateVideo = async () => {
    await operation.run(
      "generateVideo",
      "Preparing narration...",
      async (command) => {
        if (!(await commitNarratedPresentation(command.setStatus))) {
          command.clearStatus();
          return;
        }

        const savePath = await electronAPI.getVideoSavePath();
        if (!savePath) {
          command.clearStatus();
          return;
        }

        command.setStatus("Rendering video...");
        const result = await electronAPI.generateVideo({ filePath, videoOutputPath: savePath });
        if (!result.success) {
          alert(`Video generation failed: ${result.message}`);
          command.clearStatus();
          return;
        }

        alert(`Video generated successfully at: ${result.outputPath}`);
        command.showOutcome("Generated!");
      },
      (error) => alertError("Error preparing generation", error),
    );
  };

  const handleSaveAllSlides = async () => {
    await operation.run(
      "saveAllSlides",
      "Preparing narration...",
      async (command) => {
        if (!(await commitNarratedPresentation(command.setStatus))) {
          command.clearStatus();
          return;
        }

        command.showOutcome("Saved slides!");
      },
      (error) => alertError("Save error", error),
    );
  };

  const handleSaveSlide = async () => {
    await operation.run(
      "saveSlide",
      `Saving slide ${activeSlide.index}...`,
      async (command) => {
        const result = await electronAPI.saveNarratedSlide({
          filePath,
          slideIndex: activeSlide.index,
          notes: activeSlide.notes || "",
        });
        if (!result.success) {
          reportNarratedSaveFailure(result);
          command.clearStatus();
          return;
        }
        markSlidesFullySaved([{ slide: activeSlide, position: activeSlideIndex }]);
        command.showOutcome("Saved slides!");
      },
      (error) => alertError("Save error", error),
    );
  };

  const handlePlaySlide = async () => {
    await operation.run(
      "playSlide",
      `Playing slide ${activeSlideNumber}...`,
      async (command) => {
        const result = await electronAPI.playSlide({ filePath, slideIndex: activeSlideNumber });
        if (!result.success) {
          alert(`Failed to play slide: ${result.message}`);
          command.clearStatus();
          return;
        }
        command.showOutcome("Played");
      },
      (error) => alertError("Play slide error", error),
    );
  };

  const syncSlides = async (
    request: () => ReturnType<typeof electronAPI.convertPptx>,
    failureMessage: string,
    progressMessage: string,
  ) => {
    if (!(await confirmDiscardChanges())) {
      return;
    }

    await operation.run(
      "reloadAllSlides",
      progressMessage,
      async (command) => {
        const result = await request();
        if (!result.success) {
          alert(`${failureMessage}: ${result.message}`);
          command.clearStatus();
          return;
        }
        resetHistoryWithSlides(result.slides);
        setActiveSlideIndex((currentIndex) =>
          Math.min(currentIndex, Math.max(0, result.slides.length - 1)),
        );
        command.showOutcome("Synced!");
      },
      (error) => alertError(failureMessage, error),
    );
  };

  const handleReloadAllSlides = async () => {
    if (busy) {
      return;
    }

    await syncSlides(
      () => electronAPI.convertPptx(filePath),
      "Sync error",
      "Syncing all slides...",
    );
  };

  const handleReloadSlide = async () => {
    if (busy) {
      return;
    }

    if (!(await confirmDiscardChanges([activeSlideNumber]))) {
      return;
    }

    await operation.run(
      "reloadSlide",
      `Syncing slide ${activeSlideNumber}...`,
      async (command) => {
        const result: SlideElectronResult = await electronAPI.reloadSlide({
          filePath,
          slideIndex: activeSlideNumber,
        });
        if (!result.success) {
          alert(`Sync slide error: ${result.message}`);
          command.clearStatus();
          return;
        }
        const nextSlides = [...slides];
        nextSlides[activeSlideIndex] = result.slide;
        resetHistoryWithSlides(nextSlides, [result.slide]);
        command.showOutcome("Synced!");
      },
      (error) => alertError("Sync slide error", error),
    );
  };

  const handleRemoveAudio = async () => {
    await operation.run(
      "removeAudio",
      "Removing audio...",
      async (command) => {
        const result = await runRemoveAudio([activeSlideNumber]);
        if (!result.success) {
          alert(`Failed to remove audio: ${result.message}`);
          command.clearStatus();
          return;
        }
        command.showOutcome("Removed!");
      },
      (error) => alertError("Remove audio error", error),
    );
  };

  const handleRemoveAllAudio = async () => {
    await operation.run(
      "removeAllAudio",
      "Removing all audio...",
      async (command) => {
        const result = await runRemoveAudio(slides.map((slide) => slide.index));
        if (!result.success) {
          alert(`Failed to remove audio: ${result.message}`);
          command.clearStatus();
          return;
        }
        alert("Successfully removed audio from all slides.");
        command.showOutcome("Removed!");
      },
      (error) => alertError("Remove audio error", error),
    );
  };

  return (
    <Stack gap="0" h="100%" mih={0} onKeyDown={handleHistoryKeyDown}>
      <ViewerHeader
        onBack={async () => {
          if (await confirmDiscardChanges()) {
            onBack();
          }
        }}
        onOpenSettings={onOpenSettings}
        actionStates={headerActionStates}
        handlers={{
          reloadAllSlides: handleReloadAllSlides,
          saveAllSlides: handleSaveAllSlides,
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
              <SlidePreviewPane activeSlideSrc={activeSlide.src} slideNumber={activeSlideNumber} />
            </Split.Pane>

            <Split.Resizer />

            <Split.Pane grow>
              <Stack p="md" h="100%">
                <SlideActionsBar
                  actionStates={slideActionStates}
                  handlers={{
                    reloadSlide: handleReloadSlide,
                    saveSlide: handleSaveSlide,
                    playSlide: handlePlaySlide,
                    removeAudio: handleRemoveAudio,
                  }}
                />

                <SsmlToolbar
                  canUndo={viewerSession.canUndo}
                  canRedo={viewerSession.canRedo}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onInsertSelfClosingTag={insertSelfClosingTag}
                  onInsertWrappedTag={insertWrappedTag}
                />

                <NotesSectionList
                  sections={activeSections}
                  mappings={mappings}
                  slideIndex={activeSlide.index}
                  slideNotes={activeSlide.notes || ""}
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

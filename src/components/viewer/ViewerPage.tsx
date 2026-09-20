import { Stack } from "@mantine/core";
import { useCallback, useLayoutEffect, useMemo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ActionButtonState } from "../../types/viewer";
import type { Slide, SlideElectronResult } from "../../types/electron";
import { useSettings } from "../../context/useSettings";
import { getSpeakerNames } from "../../../shared/narration/speaker";
import { getErrorMessage } from "../../utils/errors";
import { NotesSectionList } from "./NotesSectionList";
import { SlideActionsBar, type SlideActionBarKey } from "./SlideActionsBar";
import { SlidePreviewPane } from "./SlidePreviewPane";
import { SlideThumbnailList } from "./SlideThumbnailList";
import { SsmlToolbar } from "./SsmlToolbar";
import { ViewerHeader, type ViewerHeaderActionKey } from "./ViewerHeader";
import { Split } from "@gfazioli/mantine-split-pane";
import { useSectionTextareas } from "./useSectionTextareas";
import { useSlideNoteEditor } from "./useSlideNoteEditor";
import { useViewerOperation } from "./useViewerOperation";

interface ViewerPageProps {
  slides: Slide[];
  filePath: string;
  onBack: () => void;
  onOpenSettings: () => void;
}

type RemoveAudioKey = "removeAudio" | "removeAllAudio";

const REMOVE_AUDIO_STATUS: Record<RemoveAudioKey, string> = {
  removeAudio: "Removing audio...",
  removeAllAudio: "Removing all audio...",
};

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

export function ViewerPage({
  slides: initialSlides,
  filePath,
  onBack,
  onOpenSettings,
}: ViewerPageProps) {
  const electronAPI = window.electronAPI;
  const { mappings } = useSettings();
  const speakerNames = useMemo(() => getSpeakerNames(mappings), [mappings]);
  const reportUnsavedChanges = useCallback(
    (hasUnsavedChanges: boolean) => electronAPI.setHasUnsavedNarrationChanges(hasUnsavedChanges),
    [electronAPI],
  );
  const editor = useSlideNoteEditor(initialSlides, speakerNames, reportUnsavedChanges);
  const textareas = useSectionTextareas();
  const operation = useViewerOperation();

  const busy = operation.busy;
  const slides = editor.slides;
  const activeSlideNumber = editor.activeSlideNumber;

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

  const { selectionIntent, selectionRestored } = editor;
  useLayoutEffect(() => {
    if (!selectionIntent) {
      return;
    }

    textareas.restore(selectionIntent);
    selectionRestored();
  }, [selectionIntent, selectionRestored, textareas]);

  async function confirmDiscardChanges(slideIndex?: number) {
    return !editor.wouldDiscard(slideIndex) || electronAPI.confirmDiscardNarrationChanges();
  }

  function insertWrappedTag(startTag: string, endTag?: string) {
    const id = editor.activeSectionId;
    const selection = id && textareas.selectionIn(id);
    if (selection) {
      editor.insertSsml({ startTag, endTag, selection });
    }
  }

  const handleHistoryKeyDown = (event: ReactKeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key === "z") {
      event.preventDefault();
      editor.undo();
    }

    if (event.key === "y") {
      event.preventDefault();
      editor.redo();
    }
  };

  /**
   * Commits the whole presentation through the narrated save path, so notes and
   * narration audio are validated, synthesized, and committed together.
   */
  async function commitNarratedPresentation(setStatus: (status: string) => void) {
    // The snapshot that was submitted, which completion reconciles against
    // rather than against whatever the author has edited by the time it returns.
    const snapshot = editor.submitSave();
    const result = await electronAPI.saveNarratedPresentation(
      {
        filePath,
        slides: snapshot.slides.map((slide) => ({
          slideIndex: slide.index,
          sections: slide.sections,
        })),
      },
      ({ completed, total }) => setStatus(`Preparing narration ${completed}/${total}...`),
    );
    if (!result.success) {
      reportNarratedSaveFailure(result);
      return false;
    }

    editor.saveSucceeded(snapshot);
    return true;
  }

  const handleGenerateVideo = () =>
    operation.run(
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

  const handleSaveAllSlides = () =>
    operation.run(
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

  const handleSaveSlide = () =>
    operation.run(
      "saveSlide",
      `Saving slide ${activeSlideNumber}...`,
      async (command) => {
        const snapshot = editor.submitSave([activeSlideNumber]);
        const submitted = snapshot.slides[0];
        if (!submitted) {
          command.clearStatus();
          return;
        }

        const result = await electronAPI.saveNarratedSlide({
          filePath,
          slideIndex: submitted.index,
          sections: submitted.sections,
        });
        if (!result.success) {
          reportNarratedSaveFailure(result);
          command.clearStatus();
          return;
        }

        editor.saveSucceeded(snapshot);
        command.showOutcome("Saved slides!");
      },
      (error) => alertError("Save error", error),
    );

  const handlePlaySlide = () =>
    operation.run(
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

  const handleReloadAllSlides = async () => {
    // A declined reload must keep the open typing group as an undo step of its own.
    editor.finalizePendingTyping();
    if (busy || !(await confirmDiscardChanges())) {
      return;
    }

    await operation.run(
      "reloadAllSlides",
      "Syncing all slides...",
      async (command) => {
        const result = await electronAPI.convertPptx(filePath);
        if (!result.success) {
          alert(`Sync error: ${result.message}`);
          command.clearStatus();
          return;
        }
        editor.reloadPresentation(result.slides);
        command.showOutcome("Synced!");
      },
      (error) => alertError("Sync error", error),
    );
  };

  const handleReloadSlide = async () => {
    editor.finalizePendingTyping();
    if (busy || !(await confirmDiscardChanges(activeSlideNumber))) {
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
        editor.reloadSlide(result.slide);
        command.showOutcome("Synced!");
      },
      (error) => alertError("Sync slide error", error),
    );
  };

  const runRemoveAudio = (owner: RemoveAudioKey, slideIndices: number[]) =>
    operation.run(
      owner,
      REMOVE_AUDIO_STATUS[owner],
      async (command) => {
        const result = await electronAPI.removeAudio({ filePath, slideIndices });
        if (!result.success) {
          alert(`Failed to remove audio: ${result.message}`);
          command.clearStatus();
          return;
        }
        command.showOutcome("Removed!");
      },
      (error) => alertError("Remove audio error", error),
    );

  return (
    <Stack gap="0" h="100%" mih={0} onKeyDown={handleHistoryKeyDown}>
      <ViewerHeader
        onBack={() => {
          editor.finalizePendingTyping();
          void confirmDiscardChanges().then((confirmed) => {
            if (confirmed) {
              onBack();
            }
          });
        }}
        onOpenSettings={() => {
          editor.finalizePendingTyping();
          onOpenSettings();
        }}
        actionStates={headerActionStates}
        handlers={{
          reloadAllSlides: () => void handleReloadAllSlides(),
          saveAllSlides: () => void handleSaveAllSlides(),
          removeAllAudio: () =>
            void runRemoveAudio(
              "removeAllAudio",
              slides.map((slide) => slide.index),
            ),
          generateVideo: () => void handleGenerateVideo(),
        }}
      />

      <Split mih={0} flex={1}>
        <Split.Pane initialWidth="10%">
          <SlideThumbnailList
            slides={slides}
            activeSlideIndex={editor.activeSlidePosition}
            onSelectSlide={editor.selectSlide}
          />
        </Split.Pane>

        <Split.Resizer />

        <Split.Pane grow>
          <Split orientation="horizontal" h="100%">
            <Split.Pane initialHeight="30%">
              <SlidePreviewPane
                activeSlideSrc={editor.activeSlideSrc}
                slideNumber={activeSlideNumber}
              />
            </Split.Pane>

            <Split.Resizer />

            <Split.Pane grow>
              <Stack p="md" h="100%">
                <SlideActionsBar
                  actionStates={slideActionStates}
                  handlers={{
                    reloadSlide: () => void handleReloadSlide(),
                    saveSlide: () => void handleSaveSlide(),
                    playSlide: () => void handlePlaySlide(),
                    removeAudio: () => void runRemoveAudio("removeAudio", [activeSlideNumber]),
                  }}
                />

                <SsmlToolbar
                  canUndo={editor.canUndo}
                  canRedo={editor.canRedo}
                  onUndo={editor.undo}
                  onRedo={editor.redo}
                  onInsertSelfClosingTag={(tag) => insertWrappedTag(tag)}
                  onInsertWrappedTag={insertWrappedTag}
                />

                <NotesSectionList
                  sections={editor.sections}
                  mappings={mappings}
                  slideIndex={activeSlideNumber}
                  onFocusSection={editor.selectSection}
                  onSpeakerChange={editor.setSectionSpeaker}
                  onSectionTextChange={editor.setSectionText}
                  onSectionPromptChange={editor.setSectionPrompt}
                  onDeleteSection={editor.deleteSection}
                  onAddSection={editor.addSection}
                  textareas={textareas}
                />
              </Stack>
            </Split.Pane>
          </Split>
        </Split.Pane>
      </Split>
    </Stack>
  );
}

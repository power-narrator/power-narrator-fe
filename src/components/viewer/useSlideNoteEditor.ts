import { useCallback, useEffect, useRef, useState } from "react";
import type { SlideIndex } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import {
  SlideNoteEditor,
  type SaveSnapshot,
  type SectionId,
  type SelectionIntent,
  type SsmlInsertion,
} from "./SlideNoteEditor";

/**
 * Binds the slide-note editor to React, so the view holds no editing state of
 * its own. Commands act on the editor the last command produced rather than on
 * the render's value, which keeps several commands in one event handler — a
 * save that first finalizes typing, say — acting on the same editing session.
 */
export function useSlideNoteEditor(
  initialSlides: Slide[],
  speakerNames: readonly string[],
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void,
) {
  const [editor, setEditor] = useState(() => SlideNoteEditor.open(initialSlides, speakerNames));
  const [selectionIntent, setSelectionIntent] = useState<SelectionIntent>();
  const latest = useRef(editor);

  const command = useCallback((change: (current: SlideNoteEditor) => SlideNoteEditor) => {
    const next = change(latest.current);
    latest.current = next;
    setEditor(next);
    return next;
  }, []);

  const selectionRestored = useCallback(() => setSelectionIntent(undefined), []);

  const reportUnsavedChanges = useRef(onUnsavedChangesChange);
  useEffect(() => {
    reportUnsavedChanges.current = onUnsavedChangesChange;
  });

  const dirty = editor.hasUnsavedChanges;
  useEffect(() => {
    reportUnsavedChanges.current(dirty);
  }, [dirty]);

  useEffect(
    () => () => {
      reportUnsavedChanges.current(false);
    },
    [],
  );

  useEffect(() => {
    command((current) => current.reclassifySpeakerTags(speakerNames));
  }, [command, speakerNames]);

  return {
    slides: editor.slides,
    activeSlideIndex: editor.activeSlideIndex,
    activeSlideSrc: editor.activeSlide?.src ?? "",
    sections: editor.sections,
    activeSectionId: editor.activeSectionId,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    selectionIntent,
    selectionRestored,

    // Read from the last command's editor, not the render's, so a caller that
    // finalizes pending typing before asking is answered about what it just left.
    wouldDiscard: (slideIndex?: SlideIndex) =>
      slideIndex === undefined
        ? latest.current.hasUnsavedChanges
        : latest.current.isSlideDirty(slideIndex),

    selectSlide: (slideIndex: SlideIndex) => command((current) => current.selectSlide(slideIndex)),
    selectSection: (id: SectionId) => command((current) => current.selectSection(id)),
    setSectionText: (id: SectionId, text: string) =>
      command((current) => current.setSectionText(id, text)),
    setSectionPrompt: (id: SectionId, prompt: string | undefined) =>
      command((current) => current.setSectionPrompt(id, prompt)),
    setSectionSpeaker: (id: SectionId, speaker: string | null) =>
      command((current) => current.setSectionSpeaker(id, speaker)),
    addSection: () => command((current) => current.addSection()),
    deleteSection: (id: SectionId) => command((current) => current.deleteSection(id)),
    insertSsml: (insertion: SsmlInsertion) => {
      let intent: SelectionIntent | undefined;
      command((current) => {
        const result = current.insertSsml(insertion);
        intent = result.selection;
        return result.editor;
      });
      setSelectionIntent(intent);
    },
    undo: () => command((current) => current.undo()),
    redo: () => command((current) => current.redo()),
    /** For the actions the editor does not own: opening settings, and reload confirmation. */
    finalizePendingTyping: () => command((current) => current.finalizePendingTyping()),

    submitSave: (slideIndices?: readonly SlideIndex[]): SaveSnapshot => {
      const submission = latest.current.beginSave(slideIndices);
      command(() => submission.editor);
      return submission.snapshot;
    },
    saveSucceeded: (snapshot: SaveSnapshot) =>
      command((current) => current.saveSucceeded(snapshot)),
    reloadSlide: (reloaded: Slide) => command((current) => current.reloadSlide(reloaded)),
    reloadPresentation: (reloaded: readonly Slide[]) =>
      command((current) => current.reloadPresentation(reloaded)),
  };
}

export type ViewerEditor = ReturnType<typeof useSlideNoteEditor>;

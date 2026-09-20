import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "../../types/electron";
import {
  activeSections,
  activeSlide,
  addSection,
  beginSave,
  canRedo,
  canUndo,
  deleteSection,
  finalizePendingTyping,
  hasUnsavedChanges,
  insertSsml,
  isSlideDirty,
  openSlideNoteEditor,
  reclassifySpeakerTags,
  redo,
  reloadPresentation,
  reloadSlide,
  saveSucceeded,
  selectSection,
  selectSlide,
  setSectionPrompt,
  setSectionSpeaker,
  setSectionText,
  undo,
  type SaveSnapshot,
  type SectionId,
  type SelectionIntent,
  type SlideNoteEditor,
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
  const [editor, setEditor] = useState(() => openSlideNoteEditor(initialSlides, speakerNames));
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

  const dirty = hasUnsavedChanges(editor);
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
    command((current) => reclassifySpeakerTags(current, speakerNames));
  }, [command, speakerNames]);

  return {
    slides: editor.slides,
    activeSlidePosition: editor.activeSlidePosition,
    activeSlideSrc: activeSlide(editor)?.src ?? "",
    /** The active slide's PowerPoint number, which persistence and playback address it by. */
    activeSlideNumber: activeSlide(editor)?.index ?? editor.activeSlidePosition + 1,
    sections: activeSections(editor),
    activeSectionId: editor.activeSectionId,
    canUndo: canUndo(editor),
    canRedo: canRedo(editor),
    selectionIntent,
    selectionRestored,

    // Read from the last command's editor, not the render's, so a caller that
    // finalizes pending typing before asking is answered about what it just left.
    wouldDiscard: (slideNumber?: number) =>
      slideNumber === undefined
        ? hasUnsavedChanges(latest.current)
        : isSlideDirty(latest.current, slideNumber),

    selectSlide: (position: number) => command((current) => selectSlide(current, position)),
    selectSection: (id: SectionId) => command((current) => selectSection(current, id)),
    setSectionText: (id: SectionId, text: string) =>
      command((current) => setSectionText(current, id, text)),
    setSectionPrompt: (id: SectionId, prompt: string | undefined) =>
      command((current) => setSectionPrompt(current, id, prompt)),
    setSectionSpeaker: (id: SectionId, speaker: string | null) =>
      command((current) => setSectionSpeaker(current, id, speaker)),
    addSection: () => command(addSection),
    deleteSection: (id: SectionId) => command((current) => deleteSection(current, id)),
    insertSsml: (insertion: SsmlInsertion) => {
      let intent: SelectionIntent | undefined;
      command((current) => {
        const result = insertSsml(current, insertion);
        intent = result.selection;
        return result.editor;
      });
      setSelectionIntent(intent);
    },
    undo: () => command(undo),
    redo: () => command(redo),
    /** For the actions the editor does not own: opening settings, and reload confirmation. */
    finalizePendingTyping: () => command(finalizePendingTyping),

    submitSave: (slideIndices?: readonly number[]): SaveSnapshot => {
      const submission = beginSave(latest.current, slideIndices);
      command(() => submission.editor);
      return submission.snapshot;
    },
    saveSucceeded: (snapshot: SaveSnapshot) =>
      command((current) => saveSucceeded(current, snapshot)),
    reloadSlide: (reloaded: Slide) => command((current) => reloadSlide(current, reloaded)),
    reloadPresentation: (reloaded: readonly Slide[]) =>
      command((current) => reloadPresentation(current, reloaded)),
  };
}

export type ViewerEditor = ReturnType<typeof useSlideNoteEditor>;

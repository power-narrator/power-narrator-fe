import {
  getEffectiveSpeaker,
  parseNarrationSections,
  type NarrationSection,
} from "../../../shared/narration/NarrationSections";
import type { Slide } from "../../types/electron";

export type SectionId = string;

export type EditorSection = NarrationSection & { id: SectionId };

export type EditorSlide = Omit<Slide, "notes" | "sections"> & { sections: EditorSection[] };

export interface SlideNoteEditor {
  slides: readonly EditorSlide[];
  /** Structured content each slide was last known to hold in PowerPoint. */
  savedSections: ReadonlyMap<number, readonly NarrationSection[]>;
  activeSlidePosition: number;
  activeSectionId: SectionId | undefined;
  /** Identities a later section must not reuse, even after deletions. */
  mintedSectionCount: number;
  history: readonly HistorySnapshot[];
  historyIndex: number;
  /** When the author last typed, while that typing is not yet a checkpoint. */
  pendingTypingAt: number | undefined;
}

interface HistorySnapshot {
  slides: readonly EditorSlide[];
  /** Which section was being edited, so undo returns the author to it. */
  activeSectionId: SectionId | undefined;
}

export interface TextRange {
  start: number;
  end: number;
}

/** Where the view should place focus and selection once the edit has rendered. */
export interface SelectionIntent extends TextRange {
  sectionId: SectionId;
}

export interface SsmlInsertion {
  startTag: string;
  /** Omitted for a self-closing tag, which is inserted at the caret. */
  endTag?: string;
  selection: TextRange;
}

export interface SsmlResult {
  editor: SlideNoteEditor;
  selection: SelectionIntent | undefined;
}

const TYPING_CHECKPOINT_PAUSE_MS = 800;

const FORMAT_KEYS = [
  "separatorBefore",
  "speakerPrefix",
  "speakerSuffix",
  "promptPrefix",
  "promptSuffix",
] as const;

const sameSection = (edited: NarrationSection, saved: NarrationSection) =>
  edited.text === saved.text &&
  edited.speaker === saved.speaker &&
  (edited.prompt || "") === (saved.prompt || "") &&
  FORMAT_KEYS.every((key) => (edited.format?.[key] || "") === (saved.format?.[key] || ""));

const sectionId = (number: number): SectionId => `section-${number}`;

const withoutIdentity = ({ id: _id, ...section }: EditorSection): NarrationSection => section;

export function openSlideNoteEditor(
  slides: readonly Slide[],
  knownSpeakers: Iterable<string>,
): SlideNoteEditor {
  const speakerNames = [...knownSpeakers];
  let mintedSectionCount = 0;
  const editorSlides = slides.map(({ notes, sections, ...slide }) => ({
    ...slide,
    // Slides arriving from the load seam are already parsed; only unparsed
    // notes still need the codec here.
    sections: (sections ?? parseNarrationSections(notes || "", speakerNames)).map((section) => ({
      ...section,
      id: sectionId(mintedSectionCount++),
    })),
  }));

  return {
    slides: editorSlides,
    savedSections: new Map(
      editorSlides.map((slide) => [slide.index, slide.sections.map(withoutIdentity)]),
    ),
    activeSlidePosition: 0,
    activeSectionId: editorSlides[0]?.sections[0]?.id,
    mintedSectionCount,
    history: [{ slides: editorSlides, activeSectionId: editorSlides[0]?.sections[0]?.id }],
    historyIndex: 0,
    pendingTypingAt: undefined,
  };
}

export const activeSlide = (editor: SlideNoteEditor): EditorSlide | undefined =>
  editor.slides[editor.activeSlidePosition];

export const activeSections = (editor: SlideNoteEditor): readonly EditorSection[] =>
  activeSlide(editor)?.sections ?? [];

export const activeSectionId = (editor: SlideNoteEditor): SectionId | undefined =>
  editor.activeSectionId;

export function selectSlide(source: SlideNoteEditor, position: number): SlideNoteEditor {
  const editor = finalizePendingTyping(source);
  const activeSlidePosition = Math.min(
    Math.max(position, 0),
    Math.max(editor.slides.length - 1, 0),
  );
  const activeSectionId = editor.slides[activeSlidePosition]?.sections[0]?.id;
  if (activeSlidePosition === editor.activeSlidePosition) {
    return activeSections(editor).some((section) => section.id === editor.activeSectionId)
      ? editor
      : { ...editor, activeSectionId };
  }

  return { ...editor, activeSlidePosition, activeSectionId };
}

export function selectSection(editor: SlideNoteEditor, id: SectionId): SlideNoteEditor {
  if (!activeSections(editor).some((section) => section.id === id)) {
    return editor;
  }

  return { ...finalizePendingTyping(editor), activeSectionId: id };
}

/**
 * `returnTo` is the section that was being edited when the change began, which
 * a later command has usually already moved away from.
 */
function checkpoint(
  editor: SlideNoteEditor,
  returnTo: SectionId | undefined = editor.activeSectionId,
): SlideNoteEditor {
  const historyIndex = editor.historyIndex + 1;
  const history = editor.history.slice(0, historyIndex);
  history[editor.historyIndex] = { ...history[editor.historyIndex]!, activeSectionId: returnTo };

  return {
    ...editor,
    history: [...history, { slides: editor.slides, activeSectionId: editor.activeSectionId }],
    historyIndex,
    pendingTypingAt: undefined,
  };
}

/**
 * Closes an open typing group, so the typing and whatever the author does next
 * remain separate undo steps.
 */
export const finalizePendingTyping = (editor: SlideNoteEditor): SlideNoteEditor =>
  editor.pendingTypingAt === undefined ? editor : checkpoint(editor);

/** Typing joins the open group until the author pauses. */
function typingEdit(
  editor: SlideNoteEditor,
  change: (editor: SlideNoteEditor) => SlideNoteEditor,
): SlideNoteEditor {
  const typedAt = Date.now();
  const base =
    editor.pendingTypingAt !== undefined &&
    typedAt - editor.pendingTypingAt >= TYPING_CHECKPOINT_PAUSE_MS
      ? checkpoint(editor)
      : editor;
  const next = change(base);
  return next === base ? editor : { ...next, pendingTypingAt: typedAt };
}

function discreteEdit(
  editor: SlideNoteEditor,
  change: (editor: SlideNoteEditor) => SlideNoteEditor,
): SlideNoteEditor {
  const finalized = finalizePendingTyping(editor);
  const next = change(finalized);
  return next === finalized ? editor : checkpoint(next, finalized.activeSectionId);
}

const slidePositionOf = (editor: SlideNoteEditor, id: SectionId): number =>
  editor.slides.findIndex((slide) => slide.sections.some((section) => section.id === id));

function withSlideSections(
  editor: SlideNoteEditor,
  slidePosition: number,
  change: (sections: readonly EditorSection[]) => EditorSection[],
): SlideNoteEditor {
  const slide = editor.slides[slidePosition];
  if (!slide) {
    return editor;
  }

  const slides = [...editor.slides];
  slides[slidePosition] = { ...slide, sections: change(slide.sections) };
  return { ...editor, slides };
}

/**
 * Edits one section in place. Untouched formatting metadata travels with the
 * section, so only the changed field is rewritten when notes are formatted.
 * An edit that changes nothing is not an edit, so it earns no undo step.
 */
function editSection(
  editor: SlideNoteEditor,
  id: SectionId,
  change: (section: EditorSection) => EditorSection,
): SlideNoteEditor {
  const slidePosition = slidePositionOf(editor, id);
  let changed = false;
  const edited = withSlideSections(editor, slidePosition, (sections) =>
    sections.map((section) => {
      if (section.id !== id) {
        return section;
      }

      const updated = change(section);
      changed = !sameSection(updated, section);
      return changed ? updated : section;
    }),
  );

  return changed ? edited : editor;
}

export const setSectionText = (
  editor: SlideNoteEditor,
  id: SectionId,
  text: string,
): SlideNoteEditor =>
  typingEdit(editor, (typing) => editSection(typing, id, (section) => ({ ...section, text })));

export const setSectionSpeaker = (
  editor: SlideNoteEditor,
  id: SectionId,
  speaker: string | null,
): SlideNoteEditor =>
  discreteEdit(editor, (discrete) =>
    editSection(discrete, id, (section) => ({ ...section, speaker: speaker || "" })),
  );

export const setSectionPrompt = (
  editor: SlideNoteEditor,
  id: SectionId,
  prompt: string | undefined,
): SlideNoteEditor =>
  typingEdit(editor, (typing) =>
    editSection(typing, id, ({ prompt: _prompt, ...section }) =>
      prompt ? { ...section, prompt } : section,
    ),
  );

/** A section carrying no formatting metadata is formatted canonically. */
export const addSection = (editor: SlideNoteEditor): SlideNoteEditor =>
  discreteEdit(editor, appendSection);

function appendSection(editor: SlideNoteEditor): SlideNoteEditor {
  if (!activeSlide(editor)) {
    return editor;
  }

  const added: EditorSection = {
    id: sectionId(editor.mintedSectionCount),
    speaker: "",
    text: "",
  };
  return {
    ...withSlideSections(editor, editor.activeSlidePosition, (sections) => [...sections, added]),
    activeSectionId: added.id,
    mintedSectionCount: editor.mintedSectionCount + 1,
  };
}

export const deleteSection = (editor: SlideNoteEditor, id: SectionId): SlideNoteEditor =>
  discreteEdit(editor, (discrete) => removeSection(discrete, id));

function removeSection(editor: SlideNoteEditor, id: SectionId): SlideNoteEditor {
  const slidePosition = slidePositionOf(editor, id);
  let nearest: EditorSection | undefined;
  const removed = withSlideSections(editor, slidePosition, (sections) => {
    const position = sections.findIndex((section) => section.id === id);
    const remaining = sections.filter((section) => section.id !== id);
    nearest = remaining[position] ?? remaining.at(-1);
    return remaining;
  });

  return editor.activeSectionId === id ? { ...removed, activeSectionId: nearest?.id } : removed;
}

function restore(editor: SlideNoteEditor, historyIndex: number): SlideNoteEditor {
  const snapshot = editor.history[historyIndex]!;
  const sections = snapshot.slides[editor.activeSlidePosition]?.sections ?? [];
  const stillPresent = (id: SectionId | undefined) => sections.some((section) => section.id === id);
  const activeSectionId = stillPresent(editor.activeSectionId)
    ? editor.activeSectionId
    : stillPresent(snapshot.activeSectionId)
      ? snapshot.activeSectionId
      : sections[0]?.id;

  return { ...editor, slides: snapshot.slides, historyIndex, activeSectionId };
}

export const canUndo = (editor: SlideNoteEditor): boolean =>
  editor.historyIndex > 0 || editor.pendingTypingAt !== undefined;

export const canRedo = (editor: SlideNoteEditor): boolean =>
  editor.pendingTypingAt === undefined && editor.historyIndex < editor.history.length - 1;

export function undo(source: SlideNoteEditor): SlideNoteEditor {
  const editor = finalizePendingTyping(source);
  return editor.historyIndex === 0 ? editor : restore(editor, editor.historyIndex - 1);
}

export function redo(source: SlideNoteEditor): SlideNoteEditor {
  const editor = finalizePendingTyping(source);
  return editor.historyIndex >= editor.history.length - 1
    ? editor
    : restore(editor, editor.historyIndex + 1);
}

/**
 * Wraps the given selection of the active section, or inserts a self-closing
 * tag at its caret, and reports where the view should put focus afterwards.
 */
export function insertSsml(editor: SlideNoteEditor, insertion: SsmlInsertion): SsmlResult {
  const { startTag, endTag = "", selection } = insertion;
  const id = editor.activeSectionId;
  const section = activeSections(editor).find((candidate) => candidate.id === id);
  if (!id || !section) {
    return { editor, selection: undefined };
  }

  const text = section.text || "";
  const start = Math.min(Math.max(selection.start, 0), text.length);
  const end = Math.min(Math.max(selection.end, start), text.length);
  const tagged =
    text.slice(0, start) + startTag + text.slice(start, end) + endTag + text.slice(end);

  return {
    editor: discreteEdit(editor, (discrete) =>
      editSection(discrete, id, (current) => ({ ...current, text: tagged })),
    ),
    selection: { sectionId: id, start: start + startTag.length, end: end + startTag.length },
  };
}

export function effectiveSpeaker(editor: SlideNoteEditor, id: SectionId): string {
  const sections = editor.slides[slidePositionOf(editor, id)]?.sections ?? [];
  return getEffectiveSpeaker(
    sections,
    sections.findIndex((section) => section.id === id),
  );
}

function slideIsDirty(editor: SlideNoteEditor, slide: EditorSlide): boolean {
  const saved = editor.savedSections.get(slide.index);
  if (!saved) {
    return slide.sections.length > 0;
  }

  return (
    saved.length !== slide.sections.length ||
    slide.sections.some((section, position) => !sameSection(section, saved[position]!))
  );
}

export const isSlideDirty = (editor: SlideNoteEditor, slideIndex: number): boolean => {
  const slide = editor.slides.find((candidate) => candidate.index === slideIndex);
  return slide !== undefined && slideIsDirty(editor, slide);
};

export const hasUnsavedChanges = (editor: SlideNoteEditor): boolean =>
  editor.slides.some((slide) => slideIsDirty(editor, slide));

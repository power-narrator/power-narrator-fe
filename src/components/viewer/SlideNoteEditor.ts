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
}

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
  };
}

export const activeSlide = (editor: SlideNoteEditor): EditorSlide | undefined =>
  editor.slides[editor.activeSlidePosition];

export const activeSections = (editor: SlideNoteEditor): readonly EditorSection[] =>
  activeSlide(editor)?.sections ?? [];

export const activeSectionId = (editor: SlideNoteEditor): SectionId | undefined =>
  editor.activeSectionId;

export function selectSlide(editor: SlideNoteEditor, position: number): SlideNoteEditor {
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

  return { ...editor, activeSectionId: id };
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
 */
const editSection = (
  editor: SlideNoteEditor,
  id: SectionId,
  change: (section: EditorSection) => EditorSection,
): SlideNoteEditor =>
  withSlideSections(editor, slidePositionOf(editor, id), (sections) =>
    sections.map((section) => (section.id === id ? change(section) : section)),
  );

export const setSectionText = (
  editor: SlideNoteEditor,
  id: SectionId,
  text: string,
): SlideNoteEditor => editSection(editor, id, (section) => ({ ...section, text }));

export const setSectionSpeaker = (
  editor: SlideNoteEditor,
  id: SectionId,
  speaker: string | null,
): SlideNoteEditor =>
  editSection(editor, id, (section) => ({ ...section, speaker: speaker || "" }));

export const setSectionPrompt = (
  editor: SlideNoteEditor,
  id: SectionId,
  prompt: string | undefined,
): SlideNoteEditor =>
  editSection(editor, id, ({ prompt: _prompt, ...section }) =>
    prompt ? { ...section, prompt } : section,
  );

/** A section carrying no formatting metadata is formatted canonically. */
export function addSection(editor: SlideNoteEditor): SlideNoteEditor {
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

export function deleteSection(editor: SlideNoteEditor, id: SectionId): SlideNoteEditor {
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

export function effectiveSpeaker(editor: SlideNoteEditor, id: SectionId): string {
  const sections = editor.slides[slidePositionOf(editor, id)]?.sections ?? [];
  return getEffectiveSpeaker(
    sections,
    sections.findIndex((section) => section.id === id),
  );
}

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

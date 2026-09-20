import {
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
}

const withoutIdentity = ({ id: _id, ...section }: EditorSection): NarrationSection => section;

export function openSlideNoteEditor(
  slides: readonly Slide[],
  knownSpeakers: Iterable<string>,
): SlideNoteEditor {
  const speakerNames = [...knownSpeakers];
  let nextSectionNumber = 0;
  const editorSlides = slides.map(({ notes, sections, ...slide }) => ({
    ...slide,
    // Slides arriving from the load seam are already parsed; only unparsed
    // notes still need the codec here.
    sections: (sections ?? parseNarrationSections(notes || "", speakerNames)).map((section) => ({
      ...section,
      id: `section-${nextSectionNumber++}`,
    })),
  }));

  return {
    slides: editorSlides,
    savedSections: new Map(
      editorSlides.map((slide) => [slide.index, slide.sections.map(withoutIdentity)]),
    ),
    activeSlidePosition: 0,
    activeSectionId: editorSlides[0]?.sections[0]?.id,
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

export function setSectionText(
  editor: SlideNoteEditor,
  id: SectionId,
  text: string,
): SlideNoteEditor {
  const slidePosition = editor.slides.findIndex((slide) =>
    slide.sections.some((section) => section.id === id),
  );
  const slide = editor.slides[slidePosition];
  if (!slide) {
    return editor;
  }

  const slides = [...editor.slides];
  slides[slidePosition] = {
    ...slide,
    sections: slide.sections.map((section) => (section.id === id ? { ...section, text } : section)),
  };
  return { ...editor, slides };
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

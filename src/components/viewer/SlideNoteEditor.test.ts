import { describe, expect, it } from "vitest";
import type { Slide } from "../../types/electron";
import {
  activeSectionId,
  activeSections,
  activeSlide,
  hasUnsavedChanges,
  isSlideDirty,
  openSlideNoteEditor,
  selectSection,
  selectSlide,
  setSectionText,
  type SlideNoteEditor,
} from "./SlideNoteEditor";

function slide(index: number, notes: string): Slide {
  return { index, image: `slide-${index}.png`, src: `slide-${index}`, notes };
}

const speakers = ["Alice", "Bob"];

function openedEditor(): SlideNoteEditor {
  return openSlideNoteEditor(
    [slide(1, "[Alice]\nFirst narration\n---\nSecond section"), slide(2, "Other narration")],
    speakers,
  );
}

const sectionTexts = (editor: SlideNoteEditor) =>
  activeSections(editor).map((section) => section.text);

describe("openSlideNoteEditor", () => {
  it("parses every slide up front", () => {
    const editor = openedEditor();

    expect(sectionTexts(editor)).toEqual(["First narration", "Second section"]);
    expect(sectionTexts(selectSlide(editor, 1))).toEqual(["Other narration"]);
  });

  it("parses speaker tags using the known speaker names", () => {
    const editor = openedEditor();

    expect(activeSections(editor)[0]?.speaker).toBe("Alice");
    expect(activeSections(openSlideNoteEditor([slide(1, "[Alice]\nText")], [])).at(0)?.text).toBe(
      "[Alice]\nText",
    );
  });

  it("uses sections already parsed at the load seam", () => {
    const editor = openSlideNoteEditor(
      [{ ...slide(1, "[Alice]\nRaw"), sections: [{ speaker: "Bob", text: "Parsed" }] }],
      speakers,
    );

    expect(activeSections(editor).map(({ speaker, text }) => ({ speaker, text }))).toEqual([
      { speaker: "Bob", text: "Parsed" },
    ]);
  });

  it("selects the first slide and its first section", () => {
    const editor = openedEditor();

    expect(activeSlide(editor)?.index).toBe(1);
    expect(activeSectionId(editor)).toBe(activeSections(editor)[0]?.id);
  });

  it("starts with no unsaved changes", () => {
    expect(hasUnsavedChanges(openedEditor())).toBe(false);
  });

  it("reports no slide when the presentation has none", () => {
    const editor = openSlideNoteEditor([], speakers);

    expect(activeSlide(editor)).toBeUndefined();
    expect(activeSections(editor)).toEqual([]);
    expect(activeSectionId(editor)).toBeUndefined();
  });
});

describe("navigating slides", () => {
  it("resets the active section when the slide changes", () => {
    const editor = openedEditor();
    const onSecondSection = selectSection(editor, activeSections(editor)[1]!.id);

    const moved = selectSlide(onSecondSection, 1);

    expect(activeSectionId(moved)).toBe(activeSections(moved)[0]?.id);
  });

  it("clamps selection to an existing slide", () => {
    const editor = openedEditor();

    expect(activeSlide(selectSlide(editor, 7))?.index).toBe(2);
    expect(activeSlide(selectSlide(editor, -3))?.index).toBe(1);
  });

  it("ignores selecting a section that is not on the active slide", () => {
    const editor = openedEditor();
    const foreignId = activeSections(selectSlide(editor, 1))[0]!.id;

    expect(activeSectionId(selectSection(editor, foreignId))).toBe(activeSectionId(editor));
  });
});

describe("editing section text", () => {
  it("updates only the edited section", () => {
    const editor = openedEditor();

    const edited = setSectionText(editor, activeSections(editor)[0]!.id, "Rewritten");

    expect(sectionTexts(edited)).toEqual(["Rewritten", "Second section"]);
  });

  it("keeps section identities stable across edits", () => {
    const editor = openedEditor();
    const ids = activeSections(editor).map((section) => section.id);

    const edited = setSectionText(editor, ids[0]!, "Rewritten");

    expect(activeSections(edited).map((section) => section.id)).toEqual(ids);
  });

  it("gives every section across the presentation a distinct identity", () => {
    const editor = openedEditor();
    const ids = [
      ...activeSections(editor).map((section) => section.id),
      ...activeSections(selectSlide(editor, 1)).map((section) => section.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores edits to an unknown section", () => {
    const editor = openedEditor();

    expect(sectionTexts(setSectionText(editor, "missing", "Rewritten"))).toEqual(
      sectionTexts(editor),
    );
  });
});

describe("dirty state", () => {
  it("marks the edited slide dirty", () => {
    const editor = openedEditor();

    const edited = setSectionText(editor, activeSections(editor)[0]!.id, "Rewritten");

    expect(isSlideDirty(edited, 1)).toBe(true);
    expect(isSlideDirty(edited, 2)).toBe(false);
    expect(hasUnsavedChanges(edited)).toBe(true);
  });

  it("clears dirty state when the saved content is restored manually", () => {
    const editor = openedEditor();
    const sectionId = activeSections(editor)[0]!.id;

    const restored = setSectionText(
      setSectionText(editor, sectionId, "Rewritten"),
      sectionId,
      "First narration",
    );

    expect(isSlideDirty(restored, 1)).toBe(false);
    expect(hasUnsavedChanges(restored)).toBe(false);
  });

  it("ignores formatting-metadata key order when comparing with the saved baseline", () => {
    const editor = openedEditor();
    const sectionId = activeSections(editor)[0]!.id;
    const reordered = {
      ...editor,
      slides: editor.slides.map((slide, position) =>
        position === 0
          ? {
              ...slide,
              sections: slide.sections.map((section) =>
                section.id === sectionId
                  ? {
                      ...section,
                      format: {
                        speakerSuffix: section.format?.speakerSuffix,
                        speakerPrefix: section.format?.speakerPrefix,
                      },
                    }
                  : section,
              ),
            }
          : slide,
      ),
    };

    expect(isSlideDirty(reordered, 1)).toBe(false);
  });
});

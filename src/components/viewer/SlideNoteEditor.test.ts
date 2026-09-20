import { describe, expect, it } from "vitest";
import { formatNarrationSections } from "../../../shared/narration/NarrationSections";
import type { Slide } from "../../types/electron";
import {
  activeSectionId,
  activeSections,
  activeSlide,
  addSection,
  deleteSection,
  effectiveSpeaker,
  hasUnsavedChanges,
  isSlideDirty,
  openSlideNoteEditor,
  selectSection,
  selectSlide,
  setSectionPrompt,
  setSectionSpeaker,
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

/** The sections as they would reach the codec, without renderer-only identities. */
const formattableSections = (editor: SlideNoteEditor) =>
  activeSections(editor).map(({ id: _id, ...section }) => section);

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

describe("editing speakers", () => {
  it("changes only the edited section's speaker", () => {
    const editor = openedEditor();

    const edited = setSectionSpeaker(editor, activeSections(editor)[1]!.id, "Bob");

    expect(activeSections(edited).map((section) => section.speaker)).toEqual(["Alice", "Bob"]);
  });

  it("keeps the existing speaker-tag formatting of an edited tag", () => {
    const editor = openSlideNoteEditor([slide(1, "[  Alice  ]\nText")], speakers);

    const edited = setSectionSpeaker(editor, activeSections(editor)[0]!.id, "Bob");

    expect(formatNarrationSections(formattableSections(edited))).toBe("[  Bob  ]\nText");
  });

  it("uses canonical formatting for a speaker tag the section did not have", () => {
    const editor = openSlideNoteEditor([slide(1, "Text")], speakers);

    const edited = setSectionSpeaker(editor, activeSections(editor)[0]!.id, "Bob");

    expect(formatNarrationSections(formattableSections(edited))).toBe("[Bob]\nText");
  });

  it("clears the speaker when no speaker is chosen", () => {
    const editor = openedEditor();

    const edited = setSectionSpeaker(editor, activeSections(editor)[0]!.id, null);

    expect(activeSections(edited)[0]?.speaker).toBe("");
  });
});

describe("editing inline prompts", () => {
  it("sets the prompt of only the edited section", () => {
    const editor = openedEditor();

    const edited = setSectionPrompt(editor, activeSections(editor)[0]!.id, "whispering");

    expect(activeSections(edited).map((section) => section.prompt)).toEqual([
      "whispering",
      undefined,
    ]);
  });

  it("treats an empty prompt as no prompt", () => {
    const editor = openedEditor();
    const sectionId = activeSections(editor)[0]!.id;

    const cleared = setSectionPrompt(
      setSectionPrompt(editor, sectionId, "whispering"),
      sectionId,
      "",
    );

    expect(activeSections(cleared)[0]?.prompt).toBeUndefined();
    expect(isSlideDirty(cleared, 1)).toBe(false);
  });

  it("keeps the existing prompt formatting of an edited prompt", () => {
    const editor = openSlideNoteEditor([slide(1, "[prompt:calm]\nText")], speakers);

    const edited = setSectionPrompt(editor, activeSections(editor)[0]!.id, "excited");

    expect(formatNarrationSections(formattableSections(edited))).toBe("[prompt:excited]\nText");
  });

  it("uses canonical formatting for a prompt the section did not have", () => {
    const editor = openSlideNoteEditor([slide(1, "Text")], speakers);

    const edited = setSectionPrompt(editor, activeSections(editor)[0]!.id, "excited");

    expect(formatNarrationSections(formattableSections(edited))).toBe("[prompt: excited]\nText");
  });
});

describe("adding sections", () => {
  it("appends an empty section to the active slide and selects it", () => {
    const editor = openedEditor();

    const added = addSection(editor);

    expect(sectionTexts(added)).toEqual(["First narration", "Second section", ""]);
    expect(activeSectionId(added)).toBe(activeSections(added)[2]?.id);
  });

  it("gives the added section an identity distinct from every other section", () => {
    const editor = addSection(addSection(openedEditor()));
    const ids = [
      ...activeSections(editor).map((section) => section.id),
      ...activeSections(selectSlide(editor, 1)).map((section) => section.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("separates the added section with canonical formatting", () => {
    const editor = addSection(openSlideNoteEditor([slide(1, "Text")], speakers));

    expect(formatNarrationSections(formattableSections(editor))).toBe("Text\n---\n");
  });

  it("marks the slide dirty", () => {
    expect(isSlideDirty(addSection(openedEditor()), 1)).toBe(true);
  });
});

describe("deleting sections", () => {
  it("removes only the deleted section", () => {
    const editor = openedEditor();

    const deleted = deleteSection(editor, activeSections(editor)[0]!.id);

    expect(sectionTexts(deleted)).toEqual(["Second section"]);
  });

  it("keeps the identities of the remaining sections", () => {
    const editor = openedEditor();
    const remainingId = activeSections(editor)[1]!.id;

    const deleted = deleteSection(editor, activeSections(editor)[0]!.id);

    expect(activeSections(deleted).map((section) => section.id)).toEqual([remainingId]);
  });

  it("selects the following section when the active one is deleted", () => {
    const editor = openedEditor();
    const followingId = activeSections(editor)[1]!.id;

    const deleted = deleteSection(editor, activeSections(editor)[0]!.id);

    expect(activeSectionId(deleted)).toBe(followingId);
  });

  it("selects the preceding section when the last one is deleted", () => {
    const editor = openedEditor();
    const [first, last] = activeSections(editor);

    const deleted = deleteSection(selectSection(editor, last!.id), last!.id);

    expect(activeSectionId(deleted)).toBe(first!.id);
  });

  it("keeps the active section when a different one is deleted", () => {
    const editor = openedEditor();
    const activeId = activeSections(editor)[1]!.id;

    const deleted = deleteSection(selectSection(editor, activeId), activeSections(editor)[0]!.id);

    expect(activeSectionId(deleted)).toBe(activeId);
  });

  it("reports no active section once the slide has none left", () => {
    const editor = openSlideNoteEditor([slide(1, "Only")], speakers);

    const deleted = deleteSection(editor, activeSections(editor)[0]!.id);

    expect(activeSections(deleted)).toEqual([]);
    expect(activeSectionId(deleted)).toBeUndefined();
  });

  it("ignores deleting an unknown section", () => {
    const editor = openedEditor();

    expect(deleteSection(editor, "missing")).toBe(editor);
  });
});

describe("effective speakers", () => {
  it("inherits the nearest earlier speaker within the slide", () => {
    const editor = openedEditor();
    const [first, second] = activeSections(editor);

    expect(effectiveSpeaker(editor, first!.id)).toBe("Alice");
    expect(effectiveSpeaker(editor, second!.id)).toBe("Alice");
  });

  it("follows the current structured sections after an edit", () => {
    const editor = openedEditor();
    const [first, second] = activeSections(editor);

    const edited = setSectionSpeaker(editor, second!.id, "Bob");

    expect(effectiveSpeaker(edited, second!.id)).toBe("Bob");
    expect(effectiveSpeaker(setSectionSpeaker(edited, first!.id, null), first!.id)).toBe("");
  });

  it("does not inherit across slides", () => {
    const editor = selectSlide(openedEditor(), 1);

    expect(effectiveSpeaker(editor, activeSections(editor)[0]!.id)).toBe("");
  });

  it("reports no speaker for an unknown section", () => {
    expect(effectiveSpeaker(openedEditor(), "missing")).toBe("");
  });
});

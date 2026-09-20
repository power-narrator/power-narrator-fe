import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  canRedo,
  canUndo,
  finalizePendingTyping,
  insertSsml,
  openSlideNoteEditor,
  redo,
  reclassifySpeakerTags,
  reloadPresentation,
  reloadSlide,
  selectSection,
  selectSlide,
  setSectionPrompt,
  setSectionSpeaker,
  setSectionText,
  undo,
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

describe("typing checkpoints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const typeInFirstSection = (editor: SlideNoteEditor, text: string) =>
    setSectionText(editor, activeSections(editor)[0]!.id, text);

  it("groups typing into one undo step until the author pauses", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "F");
    vi.advanceTimersByTime(100);
    editor = typeInFirstSection(editor, "Fi");
    vi.advanceTimersByTime(100);
    editor = typeInFirstSection(editor, "Fin");

    expect(sectionTexts(undo(editor))).toEqual(["First narration", "Second section"]);
  });

  it("starts a new undo step after an 800 ms pause", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "Before pause");
    vi.advanceTimersByTime(800);
    editor = typeInFirstSection(editor, "After pause");

    expect(sectionTexts(undo(editor))[0]).toBe("Before pause");
    expect(sectionTexts(undo(undo(editor)))[0]).toBe("First narration");
  });

  it("groups inline-prompt typing the same way", () => {
    let editor = openedEditor();
    const id = activeSections(editor)[0]!.id;

    editor = setSectionPrompt(editor, id, "Cheer");
    vi.advanceTimersByTime(100);
    editor = setSectionPrompt(editor, id, "Cheerful");

    expect(activeSections(undo(editor))[0]?.prompt).toBeUndefined();
  });

  it("finalizes pending typing before navigating to another slide", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "Typed");
    editor = selectSlide(selectSlide(editor, 1), 0);

    expect(sectionTexts(editor)[0]).toBe("Typed");
    expect(sectionTexts(undo(editor))[0]).toBe("First narration");
  });

  it("finalizes pending typing on request, for view actions the editor does not own", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "Typed");
    editor = finalizePendingTyping(editor);

    expect(canRedo(editor)).toBe(false);
    expect(sectionTexts(undo(editor))[0]).toBe("First narration");
    expect(sectionTexts(redo(undo(editor)))[0]).toBe("Typed");
  });

  it("finalizes pending typing before another section is selected", () => {
    let editor = openedEditor();
    const [first, second] = activeSections(editor);

    editor = typeInFirstSection(editor, "Typed");
    editor = setSectionText(selectSection(editor, second!.id), second!.id, "Also typed");

    const undone = undo(editor);
    expect(sectionTexts(undone)).toEqual(["Typed", "Second section"]);
    expect(sectionTexts(undo(undone))[0]).toBe("First narration");
    expect(activeSectionId(undone)).toBe(second!.id);
    expect(first).toBeDefined();
  });

  it("keeps pending typing and the next discrete action as separate undo steps", () => {
    let editor = openedEditor();
    const [first, second] = activeSections(editor);

    editor = typeInFirstSection(editor, "Typed");
    editor = setSectionSpeaker(editor, second!.id, "Bob");

    const undone = undo(editor);
    expect(activeSections(undone)[1]?.speaker).toBe("");
    expect(sectionTexts(undone)[0]).toBe("Typed");
    expect(sectionTexts(undo(undone))[0]).toBe("First narration");
    expect(effectiveSpeaker(undone, first!.id)).toBe("Alice");
  });
});

describe("undo and redo", () => {
  it("reports what history offers", () => {
    const editor = openedEditor();

    expect(canUndo(editor)).toBe(false);
    expect(canRedo(editor)).toBe(false);

    const added = addSection(editor);
    expect(canUndo(added)).toBe(true);
    expect(canRedo(added)).toBe(false);
    expect(canRedo(undo(added))).toBe(true);
    expect(canUndo(undo(added))).toBe(false);
  });

  it("restores structured sections without reparsing notes", () => {
    const editor = openedEditor();
    const formatted = formattableSections(editor);

    const speaking = setSectionSpeaker(editor, activeSections(editor)[1]!.id, "Bob");

    expect(formattableSections(undo(speaking))).toEqual(formatted);
    expect(activeSections(redo(undo(speaking)))[1]?.speaker).toBe("Bob");
  });

  it("checkpoints an added section immediately and clears its stale selection", () => {
    const editor = addSection(openedEditor());
    const addedId = activeSectionId(editor);

    const undone = undo(editor);

    expect(activeSections(undone)).toHaveLength(2);
    expect(activeSectionId(undone)).not.toBe(addedId);
    expect(activeSectionId(undone)).toBe(activeSections(undone)[0]?.id);
  });

  it("checkpoints a deleted section immediately", () => {
    const editor = openedEditor();

    const deleted = deleteSection(editor, activeSections(editor)[0]!.id);

    expect(sectionTexts(undo(deleted))).toEqual(["First narration", "Second section"]);
  });

  it("drops the redo tail once a new checkpoint is made", () => {
    const editor = undo(addSection(openedEditor()));

    const speaking = setSectionSpeaker(editor, activeSections(editor)[0]!.id, "Bob");

    expect(canRedo(speaking)).toBe(false);
    expect(activeSections(redo(speaking))).toHaveLength(2);
  });

  it("leaves dirty state matching the restored content", () => {
    const opened = openedEditor();
    const editor = setSectionText(opened, activeSections(opened)[0]!.id, "Typed");

    expect(hasUnsavedChanges(editor)).toBe(true);
    expect(hasUnsavedChanges(undo(editor))).toBe(false);
  });

  it("ignores an edit that changes nothing", () => {
    const editor = openedEditor();
    const [first] = activeSections(editor);

    expect(setSectionSpeaker(editor, first!.id, "Alice")).toBe(editor);
    expect(setSectionText(editor, first!.id, "First narration")).toBe(editor);
    expect(setSectionPrompt(editor, first!.id, undefined)).toBe(editor);
    expect(canUndo(setSectionText(editor, first!.id, "First narration"))).toBe(false);
  });

  it("returns the author to the section they were editing before the change", () => {
    const editor = openedEditor();
    const second = activeSections(editor)[1]!;

    const added = addSection(selectSection(editor, second.id));

    expect(activeSectionId(undo(added))).toBe(second.id);
  });

  it("does nothing beyond either end of the history", () => {
    const editor = openedEditor();

    expect(sectionTexts(undo(editor))).toEqual(sectionTexts(editor));
    expect(sectionTexts(redo(editor))).toEqual(sectionTexts(editor));
  });
});

describe("inserting SSML", () => {
  it("wraps the selected text and reports the selection to restore", () => {
    const editor = openedEditor();
    const id = activeSections(editor)[0]!.id;

    const result = insertSsml(editor, {
      startTag: '<emphasis level="strong">',
      endTag: "</emphasis>",
      selection: { start: 0, end: 5 },
    });

    expect(sectionTexts(result.editor)[0]).toBe(
      '<emphasis level="strong">First</emphasis> narration',
    );
    expect(result.selection).toEqual({ sectionId: id, start: 25, end: 30 });
  });

  it("inserts a self-closing tag at the caret", () => {
    const editor = openedEditor();

    const result = insertSsml(editor, {
      startTag: '<break time="500ms"/>',
      selection: { start: 5, end: 5 },
    });

    expect(sectionTexts(result.editor)[0]).toBe('First<break time="500ms"/> narration');
    expect(result.selection?.start).toBe(26);
    expect(result.selection?.end).toBe(26);
  });

  it("applies to the active section", () => {
    const editor = openedEditor();
    const second = activeSections(editor)[1]!;

    const result = insertSsml(selectSection(editor, second.id), {
      startTag: "<p>",
      endTag: "</p>",
      selection: { start: 0, end: 6 },
    });

    expect(sectionTexts(result.editor)).toEqual(["First narration", "<p>Second</p> section"]);
    expect(result.selection?.sectionId).toBe(second.id);
  });

  it("creates its own undo step after finalizing pending typing", () => {
    const opened = openedEditor();
    const editor = setSectionText(opened, activeSections(opened)[0]!.id, "Typed");

    const { editor: tagged } = insertSsml(editor, {
      startTag: "<p>",
      endTag: "</p>",
      selection: { start: 0, end: 5 },
    });

    expect(sectionTexts(tagged)[0]).toBe("<p>Typed</p>");
    expect(sectionTexts(undo(tagged))[0]).toBe("Typed");
    expect(sectionTexts(undo(undo(tagged)))[0]).toBe("First narration");
  });

  it("reports no selection intent when no section is active", () => {
    const editor = openSlideNoteEditor([], speakers);

    const result = insertSsml(editor, { startTag: "<p>", selection: { start: 0, end: 0 } });

    expect(result.editor).toBe(editor);
    expect(result.selection).toBeUndefined();
  });
});

describe("reloading one slide", () => {
  it("replaces that slide's content and its saved baseline", () => {
    const opened = openedEditor();
    const edited = setSectionText(opened, activeSections(opened)[0]!.id, "Typed");

    const reloaded = reloadSlide(edited, slide(1, "Reloaded narration"));

    expect(sectionTexts(reloaded)).toEqual(["Reloaded narration"]);
    expect(isSlideDirty(reloaded, 1)).toBe(false);
  });

  it("leaves unsaved work on other slides alone", () => {
    const opened = openedEditor();
    const otherSlide = selectSlide(opened, 1);
    const edited = setSectionText(otherSlide, activeSections(otherSlide)[0]!.id, "Unsaved");

    const reloaded = reloadSlide(edited, slide(1, "Reloaded narration"));

    expect(sectionTexts(reloaded)).toEqual(["Unsaved"]);
    expect(isSlideDirty(reloaded, 2)).toBe(true);
    expect(hasUnsavedChanges(reloaded)).toBe(true);
  });

  it("selects the first section of the reloaded slide when it is the active one", () => {
    const editor = reloadSlide(openedEditor(), slide(1, "[Bob]\nOne\n---\nTwo"));

    expect(activeSectionId(editor)).toBe(activeSections(editor)[0]?.id);
    expect(sectionTexts(editor)).toEqual(["One", "Two"]);
  });

  it("parses the reloaded notes with the editor's current speaker names", () => {
    const editor = reloadSlide(
      openSlideNoteEditor([slide(1, "Text")], []),
      slide(1, "[Alice]\nHi"),
    );

    expect(activeSections(editor)[0]).toMatchObject({ speaker: "", text: "[Alice]\nHi" });
  });

  it("ignores a slide the presentation does not contain", () => {
    const editor = openedEditor();

    expect(reloadSlide(editor, slide(7, "Nowhere"))).toBe(editor);
  });

  it("leaves no history able to restore the replaced content", () => {
    const opened = openedEditor();
    const edited = setSectionText(opened, activeSections(opened)[0]!.id, "Typed");

    const reloaded = reloadSlide(edited, slide(1, "Reloaded narration"));

    expect(sectionTexts(undo(reloaded))).toEqual(["Reloaded narration"]);
    expect(sectionTexts(undo(undo(reloaded)))).toEqual(["Reloaded narration"]);
  });

  it("keeps other slides undoable, finalizing pending typing into their history", () => {
    const opened = openedEditor();
    const otherSlide = selectSlide(opened, 1);
    const edited = setSectionText(otherSlide, activeSections(otherSlide)[0]!.id, "Unsaved");

    const undone = undo(reloadSlide(edited, slide(1, "Reloaded narration")));

    expect(sectionTexts(undone)).toEqual(["Other narration"]);
    expect(sectionTexts(selectSlide(undone, 0))).toEqual(["Reloaded narration"]);
  });
});

describe("reloading the presentation", () => {
  it("replaces every slide and saved baseline", () => {
    const opened = openedEditor();
    const edited = setSectionText(opened, activeSections(opened)[0]!.id, "Typed");

    const reloaded = reloadPresentation(edited, [slide(1, "One"), slide(2, "Two")]);

    expect(sectionTexts(reloaded)).toEqual(["One"]);
    expect(sectionTexts(selectSlide(reloaded, 1))).toEqual(["Two"]);
    expect(hasUnsavedChanges(reloaded)).toBe(false);
    expect(canUndo(reloaded)).toBe(false);
  });

  it("retains the active slide when the reload still contains it", () => {
    const editor = selectSlide(openedEditor(), 1);

    const reloaded = reloadPresentation(editor, [slide(2, "Still here"), slide(3, "New")]);

    expect(activeSlide(reloaded)?.index).toBe(2);
    expect(sectionTexts(reloaded)).toEqual(["Still here"]);
  });

  it("selects the nearest valid slide when the reload removed the active one", () => {
    const editor = selectSlide(openedEditor(), 1);

    const reloaded = reloadPresentation(editor, [slide(1, "Only slide")]);

    expect(activeSlide(reloaded)?.index).toBe(1);
    expect(activeSectionId(reloaded)).toBe(activeSections(reloaded)[0]?.id);
  });

  it("survives a reload that contains no slides", () => {
    const reloaded = reloadPresentation(openedEditor(), []);

    expect(activeSections(reloaded)).toEqual([]);
    expect(activeSectionId(reloaded)).toBeUndefined();
    expect(hasUnsavedChanges(reloaded)).toBe(false);
  });
});

describe("reclassifying speaker tags", () => {
  const unmapped = () => openSlideNoteEditor([slide(1, "[Alice]\nGreeting")], []);

  it("recognizes a bracketed line once its mapping name is added", () => {
    const editor = reclassifySpeakerTags(unmapped(), ["Alice"]);

    expect(activeSections(editor)[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
  });

  it("returns a bracketed line to narration text once its mapping name is removed", () => {
    const editor = reclassifySpeakerTags(
      openSlideNoteEditor([slide(1, "[Alice]\nGreeting")], ["Alice"]),
      [],
    );

    expect(activeSections(editor)[0]).toMatchObject({ speaker: "", text: "[Alice]\nGreeting" });
  });

  it("keeps the section identities the view is rendering", () => {
    const opened = unmapped();

    const editor = reclassifySpeakerTags(opened, ["Alice"]);

    expect(activeSections(editor)[0]?.id).toBe(activeSections(opened)[0]?.id);
    expect(activeSectionId(editor)).toBe(activeSectionId(opened));
  });

  it("reinterprets saved baselines, so untouched content stays clean", () => {
    const editor = reclassifySpeakerTags(unmapped(), ["Alice"]);

    expect(hasUnsavedChanges(editor)).toBe(false);
  });

  it("keeps edited content dirty across the reinterpretation", () => {
    const opened = unmapped();
    const edited = setSectionText(opened, activeSections(opened)[0]!.id, "[Alice]\nEdited");

    expect(hasUnsavedChanges(reclassifySpeakerTags(edited, ["Alice"]))).toBe(true);
  });

  it("reinterprets undo history, so undo never restores an obsolete classification", () => {
    const opened = unmapped();
    const added = addSection(opened);

    const editor = undo(reclassifySpeakerTags(added, ["Alice"]));

    expect(activeSections(editor)).toHaveLength(1);
    expect(activeSections(editor)[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
  });

  it("finalizes pending typing before reinterpreting", () => {
    const opened = unmapped();
    const typed = setSectionText(opened, activeSections(opened)[0]!.id, "[Alice]\nTyped");

    const editor = undo(reclassifySpeakerTags(typed, ["Alice"]));

    expect(activeSections(editor)[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
  });

  it("does nothing when the mapping names have not changed", () => {
    const editor = openedEditor();

    expect(reclassifySpeakerTags(editor, speakers)).toBe(editor);
    expect(reclassifySpeakerTags(editor, ["Bob", "Alice"])).toBe(editor);
  });

  it("mints identities only for the sections a reinterpreted divider splits off", () => {
    const opened = openSlideNoteEditor([slide(1, "[Alice]\nGreeting\n---\nSecond")], []);
    const [first, second] = activeSections(opened);
    const split = setSectionText(opened, first!.id, "One\n---\nTwo");

    const editor = reclassifySpeakerTags(split, ["Alice"]);

    expect(sectionTexts(editor)).toEqual(["One", "Two", "Second"]);
    expect(activeSections(editor)[0]?.id).toBe(first!.id);
    expect(activeSections(editor)[2]?.id).toBe(second!.id);
  });

  it("leaves a slide whose sections were all deleted empty", () => {
    const opened = unmapped();
    const emptied = deleteSection(opened, activeSections(opened)[0]!.id);

    expect(activeSections(reclassifySpeakerTags(emptied, ["Alice"]))).toEqual([]);
  });
});

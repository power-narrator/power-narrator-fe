import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatNarrationSections,
  parseNarrationSections,
  type NarrationSection,
} from "../../../shared/narration/NarrationSections";
import {
  slideNumberOf,
  toSlideIndex,
  type SlideIndex,
} from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import { SlideNoteEditor, type EditorSection, type SnapshotSlide } from "./SlideNoteEditor";

const speakers = ["Alice", "Bob"];

const at = (zeroBased: number): SlideIndex => toSlideIndex(zeroBased);

function slide(
  slideIndex: SlideIndex,
  notes: string,
  knownSpeakers: readonly string[] = speakers,
): Slide {
  const slideNumber = slideNumberOf(slideIndex);
  return {
    slideIndex,
    image: `slide-${slideNumber}.png`,
    src: `slide-${slideNumber}`,
    sections: parseNarrationSections(notes, knownSpeakers).map((section) => ({
      ...section,
      playAcrossSlides: false,
    })),
  };
}

function openedEditor(): SlideNoteEditor {
  return SlideNoteEditor.open(
    [
      slide(at(0), "[Alice]\nFirst narration\n---\nSecond section"),
      slide(at(1), "Other narration"),
    ],
    speakers,
  );
}

const sectionTexts = (editor: SlideNoteEditor) => editor.sections.map((section) => section.text);

describe("opening an editing session", () => {
  it("holds every slide's sections up front", () => {
    const editor = openedEditor();

    expect(sectionTexts(editor)).toEqual(["First narration", "Second section"]);
    expect(sectionTexts(editor.selectSlide(at(1)))).toEqual(["Other narration"]);
  });

  it("takes the sections the load seam parsed, without reading notes itself", () => {
    const editor = SlideNoteEditor.open(
      [
        {
          slideIndex: at(0),
          image: "slide-1.png",
          src: "slide-1",
          sections: [{ speaker: "Bob", text: "Parsed", playAcrossSlides: false }],
        },
      ],
      speakers,
    );

    expect(editor.sections.map(({ speaker, text }) => ({ speaker, text }))).toEqual([
      { speaker: "Bob", text: "Parsed" },
    ]);
  });

  it("lists the slides without the sections only the selected slide shows", () => {
    const editor = openedEditor();

    expect(editor.slides.map((slide) => slide.slideIndex)).toEqual([0, 1]);
    expect(editor.slides.some((slide) => "sections" in slide)).toBe(false);
  });

  it("selects the first slide and its first section", () => {
    const editor = openedEditor();

    expect(editor.activeSlideIndex).toBe(at(0));
    expect(editor.activeSectionId).toBe(editor.sections[0]?.id);
  });

  it("starts with no unsaved changes", () => {
    expect(openedEditor().hasUnsavedChanges).toBe(false);
  });

  it("reports no slide when the presentation has none", () => {
    const editor = SlideNoteEditor.open([], speakers);

    expect(editor.activeSlideIndex).toBeUndefined();
    expect(editor.activeSlide).toBeUndefined();
    expect(editor.sections).toEqual([]);
    expect(editor.activeSectionId).toBeUndefined();
  });
});

describe("navigating slides", () => {
  it("resets the active section when the slide changes", () => {
    const editor = openedEditor();
    const onSecondSection = editor.selectSection(editor.sections[1]!.id);

    const moved = onSecondSection.selectSlide(at(1));

    expect(moved.activeSectionId).toBe(moved.sections[0]?.id);
  });

  it("ignores a slide the presentation does not hold", () => {
    const editor = openedEditor();

    expect(editor.selectSlide(at(7))).toBe(editor);
    expect(editor.selectSlide(at(7)).activeSlideIndex).toBe(at(0));
  });

  it("leaves an open typing group open when the chosen slide is not held", () => {
    const opened = openedEditor();
    const editor = opened.setSectionText(opened.sections[0]!.id, "Typed");

    const unchanged = editor.selectSlide(at(7));

    expect(unchanged).toBe(editor);
    expect(sectionTexts(unchanged.undo())).toEqual(["First narration", "Second section"]);
  });

  it("selects a slide by its own index, not its place among the slides held", () => {
    const editor = SlideNoteEditor.open(
      [slide(at(0), "First narration"), slide(at(4), "Fifth narration")],
      speakers,
    );

    const moved = editor.selectSlide(at(4));

    expect(moved.activeSlideIndex).toBe(at(4));
    expect(sectionTexts(moved)).toEqual(["Fifth narration"]);
    expect(moved.selectSlide(at(1))).toBe(moved);
  });

  it("ignores selecting a section that is not on the active slide", () => {
    const editor = openedEditor();
    const foreignId = editor.selectSlide(at(1)).sections[0]!.id;

    expect(editor.selectSection(foreignId).activeSectionId).toBe(editor.activeSectionId);
  });
});

describe("editing section text", () => {
  it("updates only the edited section", () => {
    const editor = openedEditor();

    const edited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");

    expect(sectionTexts(edited)).toEqual(["Rewritten", "Second section"]);
  });

  it("keeps section identities stable across edits", () => {
    const editor = openedEditor();
    const ids = editor.sections.map((section) => section.id);

    const edited = editor.setSectionText(ids[0]!, "Rewritten");

    expect(edited.sections.map((section) => section.id)).toEqual(ids);
  });

  it("gives every section across the presentation a distinct identity", () => {
    const editor = openedEditor();
    const ids = [
      ...editor.sections.map((section) => section.id),
      ...editor.selectSlide(at(1)).sections.map((section) => section.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores edits to a section the slide no longer holds", () => {
    const editor = openedEditor();
    const staleId = editor.sections[0]!.id;
    const shortened = editor.deleteSection(staleId);

    expect(shortened.setSectionText(staleId, "Rewritten")).toBe(shortened);
  });
});

describe("handing sections onward", () => {
  it("sheds renderer-only identities from the selected slide's sections", () => {
    const editor = openedEditor();

    expect(editor.narrationSections).toEqual([
      {
        speaker: "Alice",
        text: "First narration",
        playAcrossSlides: false,
        format: { speakerPrefix: "[", speakerSuffix: "]" },
      },
      {
        speaker: "",
        text: "Second section",
        playAcrossSlides: false,
        format: { separatorBefore: "\n---\n" },
      },
    ]);
    expect(editor.narrationSections.some((section) => "id" in section)).toBe(false);
  });

  it("keeps the projection in the order narration positions are counted in", () => {
    const editor = openedEditor();

    const added = editor.addSection();

    expect(added.narrationSections.map((section) => section.text)).toEqual(
      added.sections.map((section) => section.text),
    );
  });

  it("refuses to be edited through the projection it hands out", () => {
    const editor = openedEditor();

    expect(() => {
      (editor.narrationSections[0] as { text: string }).text = "Tampered";
    }).toThrow(TypeError);
    expect(sectionTexts(editor)).toEqual(["First narration", "Second section"]);
  });
});

describe("dirty state", () => {
  it("marks the edited slide dirty", () => {
    const editor = openedEditor();

    const edited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");

    expect(edited.isSlideDirty(at(0))).toBe(true);
    expect(edited.isSlideDirty(at(1))).toBe(false);
    expect(edited.hasUnsavedChanges).toBe(true);
  });

  it("clears dirty state when the saved content is restored manually", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;

    const restored = editor
      .setSectionText(sectionId, "Rewritten")
      .setSectionText(sectionId, "First narration");

    expect(restored.isSlideDirty(at(0))).toBe(false);
    expect(restored.hasUnsavedChanges).toBe(false);
  });

  it("refuses to be edited through the sections it hands out", () => {
    const editor = openedEditor();
    const [section] = editor.sections;

    expect(() => {
      (section as { text: string }).text = "Tampered";
    }).toThrow(TypeError);
    expect(() => (editor.sections as EditorSection[]).pop()).toThrow(TypeError);
    expect(sectionTexts(editor)).toEqual(["First narration", "Second section"]);
    expect(editor.hasUnsavedChanges).toBe(false);
  });
});

describe("editing speakers", () => {
  it("changes only the edited section's speaker", () => {
    const editor = openedEditor();

    const edited = editor.setSectionSpeaker(editor.sections[1]!.id, "Bob");

    expect(edited.sections.map((section) => section.speaker)).toEqual(["Alice", "Bob"]);
  });

  it("keeps the existing speaker-tag formatting of an edited tag", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "[  Alice  ]\nText")], speakers);

    const edited = editor.setSectionSpeaker(editor.sections[0]!.id, "Bob");

    expect(formatNarrationSections(edited.narrationSections)).toBe("[  Bob  ]\nText");
  });

  it("uses canonical formatting for a speaker tag the section did not have", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "Text")], speakers);

    const edited = editor.setSectionSpeaker(editor.sections[0]!.id, "Bob");

    expect(formatNarrationSections(edited.narrationSections)).toBe("[Bob]\nText");
  });

  it("clears the speaker when no speaker is chosen", () => {
    const editor = openedEditor();

    const edited = editor.setSectionSpeaker(editor.sections[0]!.id, null);

    expect(edited.sections[0]?.speaker).toBe("");
  });
});

describe("editing inline prompts", () => {
  it("sets the prompt of only the edited section", () => {
    const editor = openedEditor();

    const edited = editor.setSectionPrompt(editor.sections[0]!.id, "whispering");

    expect(edited.sections.map((section) => section.prompt)).toEqual(["whispering", undefined]);
  });

  it("treats an empty prompt as no prompt", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;

    const cleared = editor
      .setSectionPrompt(sectionId, "whispering")
      .setSectionPrompt(sectionId, "");

    expect(cleared.sections[0]?.prompt).toBeUndefined();
    expect(cleared.isSlideDirty(at(0))).toBe(false);
  });

  it("keeps the existing prompt formatting of an edited prompt", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "[prompt:calm]\nText")], speakers);

    const edited = editor.setSectionPrompt(editor.sections[0]!.id, "excited");

    expect(formatNarrationSections(edited.narrationSections)).toBe("[prompt:excited]\nText");
  });

  it("uses canonical formatting for a prompt the section did not have", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "Text")], speakers);

    const edited = editor.setSectionPrompt(editor.sections[0]!.id, "excited");

    expect(formatNarrationSections(edited.narrationSections)).toBe("[prompt: excited]\nText");
  });
});

describe("choosing Play Across Slides", () => {
  const playback = (editor: SlideNoteEditor) =>
    editor.sections.map((section) => section.playAcrossSlides ?? false);

  it("changes only the chosen section and marks its slide dirty", () => {
    const editor = openedEditor();

    const chosen = editor.setSectionPlayAcrossSlides(editor.sections[1]!.id, true);

    expect(playback(chosen)).toEqual([false, true]);
    expect(chosen.isSlideDirty(at(0))).toBe(true);
    expect(chosen.isSlideDirty(at(1))).toBe(false);
  });

  it("is its own undo step", () => {
    const editor = openedEditor();

    const chosen = editor.setSectionPlayAcrossSlides(editor.sections[0]!.id, true);

    expect(playback(chosen.undo())).toEqual([false, false]);
    expect(chosen.undo().hasUnsavedChanges).toBe(false);
    expect(playback(chosen.undo().redo())).toEqual([true, false]);
  });

  it("stays with the surviving section when another section is deleted", () => {
    const editor = openedEditor();
    const chosen = editor.setSectionPlayAcrossSlides(editor.sections[1]!.id, true);

    const deleted = chosen.deleteSection(chosen.sections[0]!.id);

    expect(deleted.narrationSections).toEqual([
      expect.objectContaining({ text: "Second section", playAcrossSlides: true }),
    ]);
  });

  it("starts unchecked on an added section", () => {
    const editor = SlideNoteEditor.open(
      [
        {
          ...slide(at(0), "Loaded"),
          sections: [{ speaker: "", text: "Loaded", playAcrossSlides: true }],
        },
      ],
      speakers,
    );

    expect(playback(editor.addSection())).toEqual([true, false]);
  });

  it("survives speaker reclassification in content, saved baselines, and history", () => {
    const loaded = SlideNoteEditor.open(
      [
        {
          ...slide(at(0), "[Alice]\nGreeting\n---\nSecond", []),
          sections: [
            { speaker: "", text: "[Alice]\nGreeting", playAcrossSlides: true },
            {
              speaker: "",
              text: "Second",
              format: { separatorBefore: "---" },
              playAcrossSlides: false,
            },
          ],
        },
      ],
      [],
    );
    const chosen = loaded.setSectionPlayAcrossSlides(loaded.sections[1]!.id, true);

    const editor = chosen.reclassifySpeakerTags(["Alice"]);

    expect(editor.sections[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
    expect(playback(editor)).toEqual([true, true]);
    expect(playback(editor.undo())).toEqual([true, false]);
    expect(editor.undo().hasUnsavedChanges).toBe(false);
  });

  it("is submitted and committed by a save, keeping later choices pending", () => {
    const editor = openedEditor();
    const [first, second] = editor.sections;
    const { editor: submitted, snapshot } = editor
      .setSectionPlayAcrossSlides(first!.id, true)
      .beginSave([at(0)]);
    const newer = submitted.setSectionPlayAcrossSlides(second!.id, true);

    const saved = newer.saveSucceeded(snapshot);

    expect(snapshot.slides[0]?.sections.map((section) => section.playAcrossSlides)).toEqual([
      true,
      false,
    ]);
    expect(saved.isSlideDirty(at(0))).toBe(true);
    expect(saved.setSectionPlayAcrossSlides(second!.id, false).isSlideDirty(at(0))).toBe(false);
  });
});

describe("adding sections", () => {
  it("appends an empty section to the active slide and selects it", () => {
    const editor = openedEditor();

    const added = editor.addSection();

    expect(sectionTexts(added)).toEqual(["First narration", "Second section", ""]);
    expect(added.activeSectionId).toBe(added.sections[2]?.id);
  });

  it("gives the added section an identity distinct from every other section", () => {
    const editor = openedEditor().addSection().addSection();
    const ids = [
      ...editor.sections.map((section) => section.id),
      ...editor.selectSlide(at(1)).sections.map((section) => section.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("separates the added section with canonical formatting", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "Text")], speakers).addSection();

    expect(formatNarrationSections(editor.narrationSections)).toBe("Text\n---\n");
  });

  it("marks the slide dirty", () => {
    expect(openedEditor().addSection().isSlideDirty(at(0))).toBe(true);
  });
});

describe("deleting sections", () => {
  it("removes only the deleted section", () => {
    const editor = openedEditor();

    const deleted = editor.deleteSection(editor.sections[0]!.id);

    expect(sectionTexts(deleted)).toEqual(["Second section"]);
  });

  it("keeps the identities of the remaining sections", () => {
    const editor = openedEditor();
    const remainingId = editor.sections[1]!.id;

    const deleted = editor.deleteSection(editor.sections[0]!.id);

    expect(deleted.sections.map((section) => section.id)).toEqual([remainingId]);
  });

  it("selects the following section when the active one is deleted", () => {
    const editor = openedEditor();
    const followingId = editor.sections[1]!.id;

    const deleted = editor.deleteSection(editor.sections[0]!.id);

    expect(deleted.activeSectionId).toBe(followingId);
  });

  it("selects the preceding section when the last one is deleted", () => {
    const editor = openedEditor();
    const [first, last] = editor.sections;

    const deleted = editor.selectSection(last!.id).deleteSection(last!.id);

    expect(deleted.activeSectionId).toBe(first!.id);
  });

  it("keeps the active section when a different one is deleted", () => {
    const editor = openedEditor();
    const activeId = editor.sections[1]!.id;

    const deleted = editor.selectSection(activeId).deleteSection(editor.sections[0]!.id);

    expect(deleted.activeSectionId).toBe(activeId);
  });

  it("reports no active section once the slide has none left", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "Only")], speakers);

    const deleted = editor.deleteSection(editor.sections[0]!.id);

    expect(deleted.sections).toEqual([]);
    expect(deleted.activeSectionId).toBeUndefined();
  });

  it("ignores deleting a section the slide no longer holds", () => {
    const editor = openedEditor();
    const staleId = editor.sections[0]!.id;
    const shortened = editor.deleteSection(staleId);

    expect(shortened.deleteSection(staleId)).toBe(shortened);
  });
});

describe("keeping commands within the active slide", () => {
  /** An identity the author cannot have in view: it belongs to the slide they left. */
  const foreignSection = () => {
    const editor = openedEditor();
    return { editor, foreignId: editor.selectSlide(at(1)).sections[0]!.id };
  };

  it("ignores text edits addressed to a hidden slide's section", () => {
    const { editor, foreignId } = foreignSection();

    expect(editor.setSectionText(foreignId, "Rewritten")).toBe(editor);
    expect(sectionTexts(editor.setSectionText(foreignId, "Rewritten").selectSlide(at(1)))).toEqual([
      "Other narration",
    ]);
  });

  it("ignores speaker edits addressed to a hidden slide's section", () => {
    const { editor, foreignId } = foreignSection();

    expect(editor.setSectionSpeaker(foreignId, "Bob")).toBe(editor);
  });

  it("ignores prompt edits addressed to a hidden slide's section", () => {
    const { editor, foreignId } = foreignSection();

    expect(editor.setSectionPrompt(foreignId, "whispering")).toBe(editor);
  });

  it("ignores deleting a hidden slide's section", () => {
    const { editor, foreignId } = foreignSection();

    expect(editor.deleteSection(foreignId)).toBe(editor);
  });

  it("leaves the hidden slide's content, selection, dirty state, and history untouched", () => {
    const { editor, foreignId } = foreignSection();

    const unchanged = editor
      .setSectionText(foreignId, "Rewritten")
      .setSectionSpeaker(foreignId, "Bob")
      .setSectionPrompt(foreignId, "whispering")
      .deleteSection(foreignId);
    const hidden = unchanged.selectSlide(at(1));

    expect(sectionTexts(hidden)).toEqual(["Other narration"]);
    expect(hidden.sections.map((section) => section.speaker)).toEqual([""]);
    expect(hidden.sections.map((section) => section.prompt)).toEqual([undefined]);
    expect(unchanged.activeSectionId).toBe(editor.activeSectionId);
    expect(unchanged.hasUnsavedChanges).toBe(false);
    expect(unchanged.canUndo).toBe(false);
  });

  it("keeps an open typing group open", () => {
    const opened = openedEditor();
    const foreignId = opened.selectSlide(at(1)).sections[0]!.id;
    const typing = opened.setSectionText(opened.sections[0]!.id, "Typed");

    const unchanged = typing.deleteSection(foreignId);

    expect(unchanged).toBe(typing);
    expect(sectionTexts(unchanged.undo())).toEqual(["First narration", "Second section"]);
  });

  it("rejects an identity the editor did not mint", () => {
    const editor = openedEditor();

    // @ts-expect-error a section identity is minted by the editor, not written by a caller
    expect(editor.setSectionText("first section", "Rewritten")).toBe(editor);
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
    editor.setSectionText(editor.sections[0]!.id, text);

  it("groups typing into one undo step until the author pauses", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "F");
    vi.advanceTimersByTime(100);
    editor = typeInFirstSection(editor, "Fi");
    vi.advanceTimersByTime(100);
    editor = typeInFirstSection(editor, "Fin");

    expect(sectionTexts(editor.undo())).toEqual(["First narration", "Second section"]);
  });

  it("starts a new undo step after an 800 ms pause", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "Before pause");
    vi.advanceTimersByTime(800);
    editor = typeInFirstSection(editor, "After pause");

    expect(sectionTexts(editor.undo())[0]).toBe("Before pause");
    expect(sectionTexts(editor.undo().undo())[0]).toBe("First narration");
  });

  it("groups inline-prompt typing the same way", () => {
    let editor = openedEditor();
    const id = editor.sections[0]!.id;

    editor = editor.setSectionPrompt(id, "Cheer");
    vi.advanceTimersByTime(100);
    editor = editor.setSectionPrompt(id, "Cheerful");

    expect(editor.undo().sections[0]?.prompt).toBeUndefined();
  });

  it("finalizes pending typing before navigating to another slide", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "Typed");
    editor = editor.selectSlide(at(1)).selectSlide(at(0));

    expect(sectionTexts(editor)[0]).toBe("Typed");
    expect(sectionTexts(editor.undo())[0]).toBe("First narration");
  });

  it("finalizes pending typing on request, for view actions the editor does not own", () => {
    let editor = openedEditor();

    editor = typeInFirstSection(editor, "Typed");
    editor = editor.finalizePendingTyping();

    expect(editor.canRedo).toBe(false);
    expect(sectionTexts(editor.undo())[0]).toBe("First narration");
    expect(sectionTexts(editor.undo().redo())[0]).toBe("Typed");
  });

  it("finalizes pending typing before another section is selected", () => {
    let editor = openedEditor();
    const [first, second] = editor.sections;

    editor = typeInFirstSection(editor, "Typed");
    editor = editor.selectSection(second!.id).setSectionText(second!.id, "Also typed");

    const undone = editor.undo();
    expect(sectionTexts(undone)).toEqual(["Typed", "Second section"]);
    expect(sectionTexts(undone.undo())[0]).toBe("First narration");
    expect(undone.activeSectionId).toBe(second!.id);
    expect(first).toBeDefined();
  });

  it("keeps pending typing and the next discrete action as separate undo steps", () => {
    let editor = openedEditor();
    const [, second] = editor.sections;

    editor = typeInFirstSection(editor, "Typed");
    editor = editor.setSectionSpeaker(second!.id, "Bob");

    const undone = editor.undo();
    expect(undone.sections[1]?.speaker).toBe("");
    expect(sectionTexts(undone)[0]).toBe("Typed");
    expect(sectionTexts(undone.undo())[0]).toBe("First narration");
  });
});

describe("undo and redo", () => {
  it("reports what history offers", () => {
    const editor = openedEditor();

    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);

    const added = editor.addSection();
    expect(added.canUndo).toBe(true);
    expect(added.canRedo).toBe(false);
    expect(added.undo().canRedo).toBe(true);
    expect(added.undo().canUndo).toBe(false);
  });

  it("restores structured sections without reparsing notes", () => {
    const editor = openedEditor();
    const formatted = editor.narrationSections;

    const speaking = editor.setSectionSpeaker(editor.sections[1]!.id, "Bob");

    expect(speaking.undo().narrationSections).toEqual(formatted);
    expect(speaking.undo().redo().sections[1]?.speaker).toBe("Bob");
  });

  it("checkpoints an added section immediately and clears its stale selection", () => {
    const editor = openedEditor().addSection();
    const addedId = editor.activeSectionId;

    const undone = editor.undo();

    expect(undone.sections).toHaveLength(2);
    expect(undone.activeSectionId).not.toBe(addedId);
    expect(undone.activeSectionId).toBe(undone.sections[0]?.id);
  });

  it("checkpoints a deleted section immediately", () => {
    const editor = openedEditor();

    const deleted = editor.deleteSection(editor.sections[0]!.id);

    expect(sectionTexts(deleted.undo())).toEqual(["First narration", "Second section"]);
  });

  it("drops the redo tail once a new checkpoint is made", () => {
    const editor = openedEditor().addSection().undo();

    const speaking = editor.setSectionSpeaker(editor.sections[0]!.id, "Bob");

    expect(speaking.canRedo).toBe(false);
    expect(speaking.redo().sections).toHaveLength(2);
  });

  it("leaves dirty state matching the restored content", () => {
    const opened = openedEditor();
    const editor = opened.setSectionText(opened.sections[0]!.id, "Typed");

    expect(editor.hasUnsavedChanges).toBe(true);
    expect(editor.undo().hasUnsavedChanges).toBe(false);
  });

  it("ignores an edit that changes nothing", () => {
    const editor = openedEditor();
    const [first] = editor.sections;

    expect(editor.setSectionSpeaker(first!.id, "Alice")).toBe(editor);
    expect(editor.setSectionText(first!.id, "First narration")).toBe(editor);
    expect(editor.setSectionPrompt(first!.id, undefined)).toBe(editor);
    expect(editor.setSectionPlayAcrossSlides(first!.id, false)).toBe(editor);
    expect(editor.setSectionText(first!.id, "First narration").canUndo).toBe(false);
  });

  it("returns the author to the section they were editing before the change", () => {
    const editor = openedEditor();
    const second = editor.sections[1]!;

    const added = editor.selectSection(second.id).addSection();

    expect(added.undo().activeSectionId).toBe(second.id);
  });

  it("does nothing beyond either end of the history", () => {
    const editor = openedEditor();

    expect(sectionTexts(editor.undo())).toEqual(sectionTexts(editor));
    expect(sectionTexts(editor.redo())).toEqual(sectionTexts(editor));
  });
});

describe("inserting SSML", () => {
  it("wraps the selected text and reports the selection to restore", () => {
    const editor = openedEditor();
    const id = editor.sections[0]!.id;

    const result = editor.insertSsml({
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

    const result = editor.insertSsml({
      startTag: '<break time="500ms"/>',
      selection: { start: 5, end: 5 },
    });

    expect(sectionTexts(result.editor)[0]).toBe('First<break time="500ms"/> narration');
    expect(result.selection?.start).toBe(26);
    expect(result.selection?.end).toBe(26);
  });

  it("applies to the active section", () => {
    const editor = openedEditor();
    const second = editor.sections[1]!;

    const result = editor.selectSection(second.id).insertSsml({
      startTag: "<p>",
      endTag: "</p>",
      selection: { start: 0, end: 6 },
    });

    expect(sectionTexts(result.editor)).toEqual(["First narration", "<p>Second</p> section"]);
    expect(result.selection?.sectionId).toBe(second.id);
  });

  it("creates its own undo step after finalizing pending typing", () => {
    const opened = openedEditor();
    const editor = opened.setSectionText(opened.sections[0]!.id, "Typed");

    const { editor: tagged } = editor.insertSsml({
      startTag: "<p>",
      endTag: "</p>",
      selection: { start: 0, end: 5 },
    });

    expect(sectionTexts(tagged)[0]).toBe("<p>Typed</p>");
    expect(sectionTexts(tagged.undo())[0]).toBe("Typed");
    expect(sectionTexts(tagged.undo().undo())[0]).toBe("First narration");
  });

  it("reports no selection intent when no section is active", () => {
    const editor = SlideNoteEditor.open([], speakers);

    const result = editor.insertSsml({ startTag: "<p>", selection: { start: 0, end: 0 } });

    expect(result.editor).toBe(editor);
    expect(result.selection).toBeUndefined();
  });
});

describe("reloading one slide", () => {
  it("replaces that slide's content and its saved baseline", () => {
    const opened = openedEditor();
    const edited = opened.setSectionText(opened.sections[0]!.id, "Typed");

    const reloaded = edited.reloadSlide(slide(at(0), "Reloaded narration"));

    expect(sectionTexts(reloaded)).toEqual(["Reloaded narration"]);
    expect(reloaded.isSlideDirty(at(0))).toBe(false);
  });

  it("leaves unsaved work on other slides alone", () => {
    const opened = openedEditor();
    const otherSlide = opened.selectSlide(at(1));
    const edited = otherSlide.setSectionText(otherSlide.sections[0]!.id, "Unsaved");

    const reloaded = edited.reloadSlide(slide(at(0), "Reloaded narration"));

    expect(sectionTexts(reloaded)).toEqual(["Unsaved"]);
    expect(reloaded.isSlideDirty(at(1))).toBe(true);
    expect(reloaded.hasUnsavedChanges).toBe(true);
  });

  it("selects the first section of the reloaded slide when it is the active one", () => {
    const editor = openedEditor().reloadSlide(slide(at(0), "[Bob]\nOne\n---\nTwo"));

    expect(editor.activeSectionId).toBe(editor.sections[0]?.id);
    expect(sectionTexts(editor)).toEqual(["One", "Two"]);
  });

  it("ignores a slide the presentation does not contain", () => {
    const editor = openedEditor();

    expect(editor.reloadSlide(slide(at(6), "Nowhere"))).toBe(editor);
  });

  it("leaves no history able to restore the replaced content", () => {
    const opened = openedEditor();
    const edited = opened.setSectionText(opened.sections[0]!.id, "Typed");

    const reloaded = edited.reloadSlide(slide(at(0), "Reloaded narration"));

    expect(sectionTexts(reloaded.undo())).toEqual(["Reloaded narration"]);
    expect(sectionTexts(reloaded.undo().undo())).toEqual(["Reloaded narration"]);
  });

  it("keeps other slides undoable, finalizing pending typing into their history", () => {
    const opened = openedEditor();
    const otherSlide = opened.selectSlide(at(1));
    const edited = otherSlide.setSectionText(otherSlide.sections[0]!.id, "Unsaved");

    const undone = edited.reloadSlide(slide(at(0), "Reloaded narration")).undo();

    expect(sectionTexts(undone)).toEqual(["Other narration"]);
    expect(sectionTexts(undone.selectSlide(at(0)))).toEqual(["Reloaded narration"]);
  });
});

describe("reloading the presentation", () => {
  it("replaces every slide and saved baseline", () => {
    const opened = openedEditor();
    const edited = opened.setSectionText(opened.sections[0]!.id, "Typed");

    const reloaded = edited.reloadPresentation([slide(at(0), "One"), slide(at(1), "Two")]);

    expect(sectionTexts(reloaded)).toEqual(["One"]);
    expect(sectionTexts(reloaded.selectSlide(at(1)))).toEqual(["Two"]);
    expect(reloaded.hasUnsavedChanges).toBe(false);
    expect(reloaded.canUndo).toBe(false);
  });

  it("retains the active slide when the reload still contains it", () => {
    const editor = openedEditor().selectSlide(at(1));

    const reloaded = editor.reloadPresentation([slide(at(1), "Still here"), slide(at(2), "New")]);

    expect(reloaded.activeSlideIndex).toBe(at(1));
    expect(sectionTexts(reloaded)).toEqual(["Still here"]);
  });

  it("falls back to the nearest preceding slide across a gap in the indices", () => {
    const editor = SlideNoteEditor.open(
      [slide(at(0), "First"), slide(at(4), "Fifth")],
      speakers,
    ).selectSlide(at(4));

    const reloaded = editor.reloadPresentation([slide(at(1), "Second"), slide(at(9), "Tenth")]);

    expect(reloaded.activeSlideIndex).toBe(at(1));
    expect(sectionTexts(reloaded)).toEqual(["Second"]);
  });

  it("falls back to the first slide when every slide follows the active one", () => {
    const editor = SlideNoteEditor.open([slide(at(0), "First")], speakers);

    const reloaded = editor.reloadPresentation([slide(at(3), "Fourth"), slide(at(9), "Tenth")]);

    expect(reloaded.activeSlideIndex).toBe(at(3));
    expect(sectionTexts(reloaded)).toEqual(["Fourth"]);
  });

  it("reloads one slide of a gapped deck without disturbing the others", () => {
    const editor = SlideNoteEditor.open(
      [slide(at(0), "First"), slide(at(4), "Fifth")],
      speakers,
    ).selectSlide(at(4));

    const reloaded = editor.reloadSlide(slide(at(4), "Reloaded fifth"));

    expect(reloaded.activeSlideIndex).toBe(at(4));
    expect(sectionTexts(reloaded)).toEqual(["Reloaded fifth"]);
    expect(sectionTexts(reloaded.selectSlide(at(0)))).toEqual(["First"]);
  });

  it("selects the nearest valid slide when the reload removed the active one", () => {
    const editor = openedEditor().selectSlide(at(1));

    const reloaded = editor.reloadPresentation([slide(at(0), "Only slide")]);

    expect(reloaded.activeSlideIndex).toBe(at(0));
    expect(reloaded.activeSectionId).toBe(reloaded.sections[0]?.id);
  });

  it("survives a reload that contains no slides", () => {
    const reloaded = openedEditor().reloadPresentation([]);

    expect(reloaded.activeSlideIndex).toBeUndefined();
    expect(reloaded.sections).toEqual([]);
    expect(reloaded.activeSectionId).toBeUndefined();
    expect(reloaded.hasUnsavedChanges).toBe(false);
  });
});

describe("reclassifying speaker tags", () => {
  const unmapped = () => SlideNoteEditor.open([slide(at(0), "[Alice]\nGreeting", [])], []);

  it("recognizes a bracketed line once its mapping name is added", () => {
    const editor = unmapped().reclassifySpeakerTags(["Alice"]);

    expect(editor.sections[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
  });

  it("returns a bracketed line to narration text once its mapping name is removed", () => {
    const editor = SlideNoteEditor.open(
      [slide(at(0), "[Alice]\nGreeting", ["Alice"])],
      ["Alice"],
    ).reclassifySpeakerTags([]);

    expect(editor.sections[0]).toMatchObject({ speaker: "", text: "[Alice]\nGreeting" });
  });

  it("keeps the section identities the view is rendering", () => {
    const opened = unmapped();

    const editor = opened.reclassifySpeakerTags(["Alice"]);

    expect(editor.sections[0]?.id).toBe(opened.sections[0]?.id);
    expect(editor.activeSectionId).toBe(opened.activeSectionId);
  });

  it("reinterprets saved baselines, so untouched content stays clean", () => {
    const editor = unmapped().reclassifySpeakerTags(["Alice"]);

    expect(editor.hasUnsavedChanges).toBe(false);
  });

  it("keeps edited content dirty across the reinterpretation", () => {
    const opened = unmapped();
    const edited = opened.setSectionText(opened.sections[0]!.id, "[Alice]\nEdited");

    expect(edited.reclassifySpeakerTags(["Alice"]).hasUnsavedChanges).toBe(true);
  });

  it("reinterprets undo history, so undo never restores an obsolete classification", () => {
    const opened = unmapped();
    const added = opened.addSection();

    const editor = added.reclassifySpeakerTags(["Alice"]).undo();

    expect(editor.sections).toHaveLength(1);
    expect(editor.sections[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
  });

  it("finalizes pending typing before reinterpreting", () => {
    const opened = unmapped();
    const typed = opened.setSectionText(opened.sections[0]!.id, "[Alice]\nTyped");

    const editor = typed.reclassifySpeakerTags(["Alice"]).undo();

    expect(editor.sections[0]).toMatchObject({ speaker: "Alice", text: "Greeting" });
  });

  it("does nothing when the mapping names have not changed", () => {
    const editor = openedEditor();

    expect(editor.reclassifySpeakerTags(speakers)).toBe(editor);
    expect(editor.reclassifySpeakerTags(["Bob", "Alice"])).toBe(editor);
  });

  it("mints identities only for the sections a reinterpreted divider splits off", () => {
    const opened = SlideNoteEditor.open([slide(at(0), "[Alice]\nGreeting\n---\nSecond", [])], []);
    const [first, second] = opened.sections;
    const split = opened.setSectionText(first!.id, "One\n---\nTwo");

    const editor = split.reclassifySpeakerTags(["Alice"]);

    expect(sectionTexts(editor)).toEqual(["One", "Two", "Second"]);
    expect(editor.sections[0]?.id).toBe(first!.id);
    expect(editor.sections[2]?.id).toBe(second!.id);
  });

  it("leaves a slide whose sections were all deleted empty", () => {
    const opened = unmapped();
    const emptied = opened.deleteSection(opened.sections[0]!.id);

    expect(emptied.reclassifySpeakerTags(["Alice"]).sections).toEqual([]);
  });
});

describe("saving", () => {
  it("submits exactly the structured content the slides hold", () => {
    const editor = openedEditor();

    const { snapshot } = editor.beginSave();

    expect(snapshot.slides.map((slide) => slide.slideIndex)).toEqual([at(0), at(1)]);
    expect(snapshot.slides[0]?.sections).toEqual(editor.narrationSections);
  });

  it("submits only the requested slides", () => {
    const editor = openedEditor();

    expect(editor.beginSave([at(1)]).snapshot.slides.map((slide) => slide.slideIndex)).toEqual([
      at(1),
    ]);
    expect(editor.beginSave([at(6)]).snapshot.slides).toEqual([]);
  });

  it("finalizes pending typing, so the submitted content is its own undo step", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;

    const submitted = editor.setSectionText(sectionId, "Typed").beginSave().editor;

    expect(sectionTexts(submitted.undo())).toEqual(["First narration", "Second section"]);
    expect(sectionTexts(submitted.undo().redo())).toEqual(["Typed", "Second section"]);
  });

  it("refuses to be altered after submission", () => {
    const { snapshot } = openedEditor().beginSave();

    expect(() => {
      (snapshot.slides[0]!.sections as NarrationSection[])[0]!.text = "Tampered";
    }).toThrow(TypeError);
    expect(() => {
      (snapshot.slides[0] as { slideIndex: SlideIndex }).slideIndex = at(9);
    }).toThrow(TypeError);
    expect(() => (snapshot.slides as SnapshotSlide[]).pop()).toThrow(TypeError);
  });

  it("refuses to have submitted formatting metadata altered", () => {
    const editor = openedEditor();
    const { snapshot } = editor.setSectionSpeaker(editor.sections[0]!.id, "Alice").beginSave();
    const submitted = snapshot.slides[0]!.sections[0]!;

    expect(() => {
      (submitted.format as NonNullable<NarrationSection["format"]>).speakerPrefix = "<";
    }).toThrow(TypeError);
  });

  it("reconciles against the submitted content even when a caller tries to rewrite it", () => {
    const editor = openedEditor();
    const edited = editor.setSectionText(editor.sections[0]!.id, "Submitted");
    const { editor: submitted, snapshot } = edited.beginSave();

    try {
      (snapshot.slides[0]!.sections as NarrationSection[])[0]!.text = "Tampered";
    } catch {
      // A frozen snapshot rejects the write; what matters is what is committed.
    }

    expect(submitted.saveSucceeded(snapshot).isSlideDirty(at(0))).toBe(false);
    expect(sectionTexts(submitted.saveSucceeded(snapshot))).toEqual([
      "Submitted",
      "Second section",
    ]);
  });

  it("commits both overlapping saves when they complete in the order submitted", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;
    const older = editor.setSectionText(sectionId, "Older").beginSave();
    const newer = older.editor.setSectionText(sectionId, "Newer").beginSave();

    const settled = newer.editor.saveSucceeded(older.snapshot).saveSucceeded(newer.snapshot);

    expect(settled.isSlideDirty(at(0))).toBe(false);
    expect(settled.hasUnsavedChanges).toBe(false);
  });

  it("keeps the newer baseline when an older overlapping save completes last", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;
    const older = editor.setSectionText(sectionId, "Older").beginSave();
    const newer = older.editor.setSectionText(sectionId, "Newer").beginSave();

    const settled = newer.editor.saveSucceeded(newer.snapshot).saveSucceeded(older.snapshot);

    expect(settled.isSlideDirty(at(0))).toBe(false);
    expect(sectionTexts(settled)).toEqual(["Newer", "Second section"]);
    expect(sectionTexts(settled.setSectionText(sectionId, "Older"))).toEqual([
      "Older",
      "Second section",
    ]);
    expect(settled.setSectionText(sectionId, "Older").isSlideDirty(at(0))).toBe(true);
  });

  it("leaves the live editor free to keep changing while the operation runs", () => {
    const editor = openedEditor();
    const { editor: submitted, snapshot } = editor.beginSave();

    const newer = submitted.setSectionText(submitted.sections[0]!.id, "Written while saving");

    expect(sectionTexts(newer)[0]).toBe("Written while saving");
    expect(snapshot.slides[0]?.sections[0]?.text).toBe("First narration");
  });

  it("clears dirty state for the slides the save committed", () => {
    const editor = openedEditor();
    const edited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");
    const { editor: submitted, snapshot } = edited.beginSave();

    const saved = submitted.saveSucceeded(snapshot);

    expect(saved.isSlideDirty(at(0))).toBe(false);
    expect(saved.hasUnsavedChanges).toBe(false);
  });

  it("clears dirty state across every slide a whole-presentation save committed", () => {
    const editor = openedEditor();
    const firstEdited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");
    const onSecond = firstEdited.selectSlide(at(1));
    const bothEdited = onSecond.setSectionText(onSecond.sections[0]!.id, "Also rewritten");
    const { editor: submitted, snapshot } = bothEdited.beginSave();

    const saved = submitted.saveSucceeded(snapshot);

    expect(saved.isSlideDirty(at(0))).toBe(false);
    expect(saved.isSlideDirty(at(1))).toBe(false);
    expect(saved.hasUnsavedChanges).toBe(false);
  });

  it("leaves other slides dirty when one slide is saved", () => {
    const editor = openedEditor();
    const firstEdited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");
    const onSecond = firstEdited.selectSlide(at(1));
    const bothEdited = onSecond.setSectionText(onSecond.sections[0]!.id, "Also rewritten");
    const { editor: submitted, snapshot } = bothEdited.beginSave([at(0)]);

    const saved = submitted.saveSucceeded(snapshot);

    expect(saved.isSlideDirty(at(0))).toBe(false);
    expect(saved.isSlideDirty(at(1))).toBe(true);
    expect(saved.hasUnsavedChanges).toBe(true);
  });

  it("clears dirty state only for the submitted slides whose notes were confirmed written", () => {
    const editor = openedEditor();
    const firstEdited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");
    const onSecond = firstEdited.selectSlide(at(1));
    const bothEdited = onSecond.setSectionText(onSecond.sections[0]!.id, "Also rewritten");
    const { editor: submitted, snapshot } = bothEdited.beginSave();

    const saved = submitted.saveSucceeded(snapshot, [at(0)]);

    expect(saved.isSlideDirty(at(0))).toBe(false);
    expect(saved.isSlideDirty(at(1))).toBe(true);
    expect(sectionTexts(saved)).toEqual(["Also rewritten"]);
  });

  it("keeps edits made after submission dirty once the older save succeeds", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;
    const { editor: submitted, snapshot } = editor.setSectionText(sectionId, "Sent").beginSave();
    const newer = submitted.setSectionText(sectionId, "Written while saving");

    const saved = newer.saveSucceeded(snapshot);

    expect(sectionTexts(saved)).toEqual(["Written while saving", "Second section"]);
    expect(saved.isSlideDirty(at(0))).toBe(true);
  });

  it("clears dirty state again when the newer edit is restored to the saved content", () => {
    const editor = openedEditor();
    const sectionId = editor.sections[0]!.id;
    const { editor: submitted, snapshot } = editor.setSectionText(sectionId, "Sent").beginSave();
    const newer = submitted.setSectionText(sectionId, "Written while saving");

    const restored = newer.saveSucceeded(snapshot).setSectionText(sectionId, "Sent");

    expect(restored.isSlideDirty(at(0))).toBe(false);
    expect(restored.hasUnsavedChanges).toBe(false);
  });

  it("keeps the submitted content dirty while a save has not succeeded", () => {
    const editor = openedEditor();
    const edited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");

    const failed = edited.beginSave().editor;

    expect(failed.isSlideDirty(at(0))).toBe(true);
    expect(failed.hasUnsavedChanges).toBe(true);
  });

  it("commits the retry of a failed save", () => {
    const editor = openedEditor();
    const edited = editor.setSectionText(editor.sections[0]!.id, "Rewritten");
    const failed = edited.beginSave().editor;
    const retry = failed.beginSave();

    expect(retry.editor.saveSucceeded(retry.snapshot).hasUnsavedChanges).toBe(false);
  });

  it("keeps the reloaded content of a slide PowerPoint replaced while the save ran", () => {
    const editor = openedEditor();
    const edited = editor.setSectionText(editor.sections[0]!.id, "Submitted");
    const { editor: submitted, snapshot } = edited.beginSave([at(0)]);
    const reloaded = submitted.reloadSlide(slide(at(0), "PowerPoint replaced this"));

    const saved = reloaded.saveSucceeded(snapshot);

    expect(sectionTexts(saved)).toEqual(["PowerPoint replaced this"]);
    expect(saved.isSlideDirty(at(0))).toBe(false);
  });

  it("ignores a slide the presentation no longer contains", () => {
    const editor = openedEditor();
    const { snapshot } = editor.beginSave([at(1)]);

    const saved = editor.reloadPresentation([slide(at(0), "Only slide")]).saveSucceeded(snapshot);

    expect(saved.slides.map((editorSlide) => editorSlide.slideIndex)).toEqual([at(0)]);
    expect(saved.hasUnsavedChanges).toBe(false);
  });
});

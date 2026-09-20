import { describe, expect, it } from "vitest";
import { parseNarrationSections } from "./NarrationSections.js";
import { toNarrationSections, toNotesText, type SlideNotePayload } from "./slideNotePayload.js";

const NOTES = "  [ Narrator ]  \n[p: almost whispering]\nFirst\n\n-----\n[Guest]\nSecond\n";

describe("slide-note payloads", () => {
  it("reads structured sections without parsing note text", () => {
    const sections = [{ speaker: "Narrator", text: "Hello" }];

    expect(toNarrationSections({ sections }, [])).toEqual(sections);
  });

  it("parses legacy note text under the supplied speaker names", () => {
    expect(toNarrationSections({ notes: "[Narrator]\nHello" }, ["Narrator"])).toEqual([
      expect.objectContaining({ speaker: "Narrator", text: "Hello" }),
    ]);
  });

  it("treats a bracketed line without a mapping as narration text", () => {
    expect(toNarrationSections({ notes: "[Narrator]\nHello" }, [])).toEqual([
      expect.objectContaining({ speaker: "", text: "[Narrator]\nHello" }),
    ]);
  });

  it("formats structured sections back to note text", () => {
    expect(toNotesText({ sections: parseNarrationSections(NOTES, ["Narrator", "Guest"]) })).toBe(
      NOTES,
    );
  });

  it("passes legacy note text through untouched", () => {
    expect(toNotesText({ notes: NOTES })).toBe(NOTES);
  });

  it("preserves untouched note formatting byte for byte across cross-process transport", () => {
    const payload: SlideNotePayload = {
      sections: parseNarrationSections(NOTES, ["Narrator", "Guest"]),
    };

    const transported = structuredClone(payload) as SlideNotePayload;

    expect(toNotesText(transported)).toBe(NOTES);
  });

  it("formats a section added without formatting metadata canonically", () => {
    const sections = parseNarrationSections("[Narrator]\nFirst", ["Narrator"]);
    sections.push({ speaker: "Guest", prompt: "wearily", text: "Second" });

    expect(toNotesText({ sections })).toBe(
      "[Narrator]\nFirst\n---\n[Guest]\n[prompt: wearily]\nSecond",
    );
  });
});

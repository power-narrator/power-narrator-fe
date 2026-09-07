import { describe, expect, it } from "vitest";
import { formatNarrationSections, parseNarrationSections } from "./NarrationSections.js";

describe("narration section formatting", () => {
  it("round-trips distinct separator, speaker tag, and body formatting", () => {
    const notes =
      "Opening line  \n" +
      "\t-----  \n" +
      "\n" +
      "  [ Narrator ]\t\n" +
      "  First line\n\n" +
      " \t---\t\n" +
      "Plain section \n" +
      "--------\n" +
      "\t[Guest]\t\n" +
      "Last line  ";

    expect(formatNarrationSections(parseNarrationSections(notes))).toBe(notes);
  });

  it("keeps the original formatting when the speaker and body are edited", () => {
    const sections = parseNarrationSections(
      "Heading\n \t----- \t\n\n  [ Narrator ]  \nOriginal text",
    );
    expect(sections).toHaveLength(2);

    const section = sections[1];
    if (!section) {
      throw new Error("Expected a second note section");
    }

    expect(section.speaker).toBe("Narrator");
    expect(section.text).toBe("Original text");

    section.speaker = "Guest";
    section.text = "Updated text";

    expect(formatNarrationSections(sections)).toBe(
      "Heading\n \t----- \t\n\n  [ Guest ]  \nUpdated text",
    );
  });

  it.each([
    ["leading", "  --- \nText"],
    ["consecutive", "Text\n---\n \t---- \nMore"],
    ["trailing", "Text\n---\n"],
  ])("preserves %s separators around empty sections", (_placement, notes) => {
    expect(formatNarrationSections(parseNarrationSections(notes))).toBe(notes);
  });

  it("uses canonical formatting for sections without format metadata", () => {
    expect(
      formatNarrationSections([
        { speaker: "", text: "Opening" },
        { speaker: "Narrator", text: "Second section" },
      ]),
    ).toBe("Opening\n---\n[Narrator]\nSecond section");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatNarrationSections,
  getEffectiveSpeaker,
  parseNarrationSections,
} from "./NarrationSections.js";
import { toSpeakerPrompt } from "./prompt.js";

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

    expect(formatNarrationSections(parseNarrationSections(notes, []))).toBe(notes);
  });

  it("keeps the original formatting when the speaker and body are edited", () => {
    const sections = parseNarrationSections(
      "Heading\n \t----- \t\n\n  [ Narrator ]  \nOriginal text",
      ["Narrator"],
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
    expect(formatNarrationSections(parseNarrationSections(notes, []))).toBe(notes);
  });

  it.each(["\u2028", "\u2029"])(
    "normalizes PowerPoint's %j line ending before the speaker tag",
    (lineEnding) => {
      const sections = parseNarrationSections(`[Narrator]${lineEnding}Stored text`, ["Narrator"]);

      expect(sections).toEqual([
        expect.objectContaining({ speaker: "Narrator", text: "Stored text" }),
      ]);
    },
  );

  it("uses canonical formatting for sections without format metadata", () => {
    expect(
      formatNarrationSections([
        { speaker: "", text: "Opening" },
        { speaker: "Narrator", text: "Second section" },
      ]),
    ).toBe("Opening\n---\n[Narrator]\nSecond section");
  });
});

describe("inline prompts in slide notes", () => {
  const parse = (notes: string) => parseNarrationSections(notes, ["Narrator", "Guest"]);

  it.each([
    ["short marker", "[p: whisper it]"],
    ["long marker", "[prompt: whisper it]"],
    ["capitalised", "[P: whisper it]"],
    ["mixed case", "[PrOmPt: whisper it]"],
    ["padded marker", "[  prompt  : whisper it]"],
  ])("recognises a %s prompt", (_spelling, tag) => {
    const [section] = parse(`[Narrator]\n${tag}\nHello`);

    // The marker's own padding is punctuation; everything past the colon,
    // the space included, is the prompt the author wrote.
    expect(section).toMatchObject({ speaker: "Narrator", prompt: " whisper it", text: "Hello" });
  });

  it("keeps the spacing an author put around a prompt", () => {
    const [section] = parse("[Narrator]\n[prompt:  whisper it  ]\nHello");

    expect(section).toMatchObject({ prompt: "  whisper it  ", text: "Hello" });
  });

  it("reads a prompt spanning several lines", () => {
    const [section] = parse(
      "[Narrator]\n[prompt:whisper it,\nthen pause\nbefore the last word]\nHello",
    );

    expect(section).toMatchObject({
      prompt: "whisper it,\nthen pause\nbefore the last word",
      text: "Hello",
    });
  });

  it("reads a prompt in a section with no speaker tag", () => {
    const [section] = parse("[prompt:whisper it]\nHello");

    expect(section).toMatchObject({ speaker: "", prompt: "whisper it", text: "Hello" });
  });

  it("applies a prompt only to its own section", () => {
    const sections = parse("[Narrator]\n[p:whisper]\nFirst\n---\nSecond");

    expect(sections.map((section) => section.prompt)).toEqual(["whisper", undefined]);
    expect(getEffectiveSpeaker(sections, 1)).toBe("Narrator");
  });

  it.each([
    ["an unknown speaker name", "[Narratr]\nHello"],
    ["a Gemini style tag", "[sigh]\nHello"],
    ["an unterminated bracket", "[prompt: whisper\nHello"],
    ["a bracket closed mid-line", "[p: whisper] now\nHello"],
  ])("leaves %s in the narration text", (_case, notes) => {
    const [section] = parse(notes);

    expect(section).toMatchObject({ speaker: "", text: notes });
    expect(section?.prompt).toBeUndefined();
  });

  it("narrates nothing for a prompt the author emptied", () => {
    const [section] = parse("[Narrator]\n[p:   ]\nHello");

    expect(section).toMatchObject({ speaker: "Narrator", text: "Hello" });
    expect(toSpeakerPrompt(section?.prompt)).toBeUndefined();
  });

  it("leaves a second prompt-shaped line in the narration text", () => {
    const [section] = parse("[Narrator]\n[p:whisper]\n[p: shout]\nHello");

    expect(section).toMatchObject({ prompt: "whisper", text: "[p: shout]\nHello" });
  });

  it.each([
    [
      "a speaker and a padded marker",
      "\n\t[ Narrator ] \n\n  [ PROMPT :  whisper it  ]\t\nHello  ",
    ],
    ["no speaker", "[p:whisper]\nHello"],
    ["a multi-line prompt", "[Guest]\n[prompt:\n  whisper it\n]\nHello"],
  ])("round-trips %s byte for byte", (_case, notes) => {
    expect(formatNarrationSections(parse(notes))).toBe(notes);
  });

  it.each([
    ["[prompt: whisper]", " whisper it"],
    ["[prompt: whisper]", "whisper it "],
    ["[prompt: whisper]", "whisper  it"],
    ["[prompt:whisper]", " whisper it"],
    ["[p:]", " "],
  ])("keeps an edit to %s as %o through the round-trip a keystroke performs", (tag, prompt) => {
    const sections = parse(`[Narrator]\n${tag}\nHello`);
    sections[0]!.prompt = prompt;

    expect(parse(formatNarrationSections(sections))[0]?.prompt).toBe(prompt);
  });

  it("uses canonical formatting for a prompt without format metadata", () => {
    expect(
      formatNarrationSections([{ speaker: "Narrator", prompt: "whisper", text: "Hello" }]),
    ).toBe("[Narrator]\n[prompt:whisper]\nHello");
  });
});

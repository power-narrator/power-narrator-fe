import { describe, expect, it } from "vitest";
import { speakerNameProblem } from "./speakerName.js";

describe("speaker name validation", () => {
  it.each(["Narrator", "speaker 1", "Dr. Aoede", "prompt", "note: aside", "Guest: Kore"])("accepts %j", (name) => {
    expect(speakerNameProblem(name)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "  \t"],
    ["a closing bracket", "Narrator]"],
    ["a line break", "Narrator\nGuest"],
    ["the long prompt marker", "prompt: whisper"],
    ["the long prompt marker without a space", "prompt:whisper"],
    ["the short prompt marker", "p: whisper"],
    ["the short prompt marker without a space", "P:whisper"],
    ["a padded prompt marker", "  prompt : whisper"],
  ])("refuses a name with %s", (_case, name) => {
    expect(speakerNameProblem(name)).not.toBeNull();
  });
});

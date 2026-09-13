import { describe, expect, it } from "vitest";
import { speakerNameProblem } from "./speakerName.js";

describe("speaker name validation", () => {
  it.each(["Narrator", "speaker 1", "Dr. Aoede", "prompt"])("accepts %j", (name) => {
    expect(speakerNameProblem(name)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "  \t"],
    ["a closing bracket", "Narrator]"],
    ["a line break", "Narrator\nGuest"],
    ["the prompt marker", "prompt: whisper"],
    ["a marker that does not exist yet", "note : aside"],
  ])("refuses a name with %s", (_case, name) => {
    expect(speakerNameProblem(name)).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { withSlideSections, withSlidesSections } from "./structuredSlideNotes.js";

const knownSpeakers = ["Narrator"];
const slide = (index: number, notes: string) => ({
  index,
  image: `${index}.png`,
  src: `app://${index}.png`,
  notes,
});

describe("structured slide notes", () => {
  it("replaces a reloaded slide's raw notes with its sections", () => {
    const result = withSlideSections(
      { success: true, slide: slide(1, "[Narrator]\nHello") },
      knownSpeakers,
    );

    expect(result).toEqual({
      success: true,
      slide: {
        index: 1,
        image: "1.png",
        src: "app://1.png",
        sections: [expect.objectContaining({ speaker: "Narrator", text: "Hello" })],
      },
    });
  });

  it("attaches sections to every slide of a loaded presentation", () => {
    const result = withSlidesSections(
      { success: true, slides: [slide(1, "[Narrator]\nFirst"), slide(2, "[Guest]\nSecond")] },
      knownSpeakers,
    );

    expect(result.success && result.slides.map((loaded) => loaded.sections)).toEqual([
      [expect.objectContaining({ speaker: "Narrator", text: "First" })],
      [expect.objectContaining({ speaker: "", text: "[Guest]\nSecond" })],
    ]);
  });

  it("leaves a failed load untouched", () => {
    const failure = { success: false as const, message: "File not found" };

    expect(withSlidesSections(failure, knownSpeakers)).toBe(failure);
    expect(withSlideSections(failure, knownSpeakers)).toBe(failure);
  });
});

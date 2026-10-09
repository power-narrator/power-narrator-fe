import { expect, it } from "vitest";
import { getSpeakerNames } from "../../shared/narration/speaker.js";
import { slideIndexFromOneBased } from "../../shared/slides/slideCoordinates.js";
import type { SlidePptResult, SlidesPptResult } from "../platform/types.js";
import type { SpeakerMapping } from "../tts/TtsProvider.js";
import { withSlideSections, withSlidesSections } from "./structuredSlideNotes.js";

const mappings: Record<string, SpeakerMapping> = {
  Narrator: {
    voice: {
      provider: "gcp",
      voiceId: "Narrator",
      model: "chirp-3-hd",
      languageCode: "en-US",
      supportsPrompt: false,
    },
  },
};

const rawSlide = (
  slideNumber: number,
  notes: string,
  sectionsPlayingAcrossSlides: ReadonlySet<number> = new Set(),
) => ({
  slideIndex: slideIndexFromOneBased(slideNumber),
  image: `slide-${slideNumber}.png`,
  src: `app://slide-${slideNumber}.png`,
  notes,
  sectionsPlayingAcrossSlides,
});

it("structures every slide in a loaded presentation", () => {
  const loaded: SlidesPptResult = {
    success: true,
    slides: [
      rawSlide(1, "[Narrator]\nOpening line"),
      rawSlide(2, "[Stage direction]\nSecond slide"),
    ],
  };

  expect(withSlidesSections(loaded, getSpeakerNames(mappings))).toEqual({
    success: true,
    slides: [
      {
        slideIndex: slideIndexFromOneBased(1),
        image: "slide-1.png",
        src: "app://slide-1.png",
        sections: [expect.objectContaining({ speaker: "Narrator", text: "Opening line" })],
      },
      {
        slideIndex: slideIndexFromOneBased(2),
        image: "slide-2.png",
        src: "app://slide-2.png",
        // No mapping names it, so the bracketed line stays narration text.
        sections: [
          expect.objectContaining({ speaker: "", text: "[Stage direction]\nSecond slide" }),
        ],
      },
    ],
  });
});

it("structures one reloaded slide", () => {
  const loaded: SlidePptResult = {
    success: true,
    slide: rawSlide(1, "[Narrator]\nReplaced line"),
  };

  expect(withSlideSections(loaded, getSpeakerNames(mappings))).toEqual({
    success: true,
    slide: {
      slideIndex: slideIndexFromOneBased(1),
      image: "slide-1.png",
      src: "app://slide-1.png",
      sections: [expect.objectContaining({ speaker: "Narrator", text: "Replaced line" })],
    },
  });
});

it("gives each section the playback of the audio at its own position, counting blank sections", () => {
  const loaded: SlidePptResult = {
    success: true,
    slide: rawSlide(1, "First\n---\n\n---\nThird\n---\nFourth", new Set([2])),
  };

  const structured = withSlideSections(loaded, getSpeakerNames(mappings));

  expect(structured.success && structured.slide.sections).toEqual([
    expect.objectContaining({ text: "First", playAcrossSlides: false }),
    expect.objectContaining({ text: "", playAcrossSlides: false }),
    expect.objectContaining({ text: "Third", playAcrossSlides: true }),
    expect.objectContaining({ text: "Fourth", playAcrossSlides: false }),
  ]);
});

it("leaves a failed load untouched", () => {
  const failure = { success: false as const, message: "File not found" };

  expect(withSlidesSections(failure, getSpeakerNames(mappings))).toBe(failure);
  expect(withSlideSections(failure, getSpeakerNames(mappings))).toBe(failure);
});

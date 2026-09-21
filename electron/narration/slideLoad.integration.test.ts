import { expect, it, vi } from "vitest";
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

const rawSlide = (slideNumber: number, notes: string) => ({
  slideIndex: slideIndexFromOneBased(slideNumber),
  image: `slide-${slideNumber}.png`,
  src: `app://slide-${slideNumber}.png`,
  notes,
});

/** The adapters hand back raw note text; main adapts their results at this seam. */
function powerPointAdapter() {
  return {
    convertPptx: vi.fn<() => Promise<SlidesPptResult>>().mockResolvedValue({
      success: true,
      slides: [
        rawSlide(1, "[Narrator]\nOpening line"),
        rawSlide(2, "[Stage direction]\nSecond slide"),
      ],
    }),
    reloadSlide: vi.fn<() => Promise<SlidePptResult>>().mockResolvedValue({
      success: true,
      slide: rawSlide(1, "[Narrator]\nReplaced line"),
    }),
  };
}

it("hands the renderer a loaded presentation as structured sections, not note text", async () => {
  const powerpoint = powerPointAdapter();

  const result = withSlidesSections(await powerpoint.convertPptx(), getSpeakerNames(mappings));

  expect(result).toEqual({
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

it("hands the renderer a reloaded slide as structured sections, not note text", async () => {
  const powerpoint = powerPointAdapter();

  const result = withSlideSections(await powerpoint.reloadSlide(), getSpeakerNames(mappings));

  expect(result).toEqual({
    success: true,
    slide: {
      slideIndex: slideIndexFromOneBased(1),
      image: "slide-1.png",
      src: "app://slide-1.png",
      sections: [expect.objectContaining({ speaker: "Narrator", text: "Replaced line" })],
    },
  });
});

it("leaves a failed load untouched", () => {
  const failure = { success: false as const, message: "File not found" };

  expect(withSlidesSections(failure, getSpeakerNames(mappings))).toBe(failure);
  expect(withSlideSections(failure, getSpeakerNames(mappings))).toBe(failure);
});

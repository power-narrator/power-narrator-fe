import { parseNarrationSections } from "../../shared/narration/NarrationSections.js";
import type { SlidePptResult, SlidesPptResult, SlideWithSrc } from "../platform/types.js";

/**
 * Notes are parsed here, immediately outside the PowerPoint adapters, so raw
 * note syntax never travels further into the application than this seam.
 */
const parseSlide = (slide: SlideWithSrc, knownSpeakers: Iterable<string>): SlideWithSrc => ({
  ...slide,
  sections: parseNarrationSections(slide.notes, knownSpeakers),
});

export const withSlideSections = (
  result: SlidePptResult,
  knownSpeakers: Iterable<string>,
): SlidePptResult =>
  result.success ? { ...result, slide: parseSlide(result.slide, knownSpeakers) } : result;

export const withSlidesSections = (
  result: SlidesPptResult,
  knownSpeakers: Iterable<string>,
): SlidesPptResult =>
  result.success
    ? { ...result, slides: result.slides.map((slide) => parseSlide(slide, knownSpeakers)) }
    : result;

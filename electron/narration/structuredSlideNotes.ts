import { parseNarrationSections } from "../../shared/narration/NarrationSections.js";
import { slideIndexFromLegacyNumber, toSlideNumber } from "../../shared/slides/slideCoordinates.js";
import type {
  StructuredSlide,
  StructuredSlideResult,
  StructuredSlidesResult,
} from "../../shared/types/slides.js";
import type { SlidePptResult, SlidesPptResult, SlideWithSrc } from "../platform/types.js";

/**
 * Notes are parsed here, immediately outside the PowerPoint adapters, so raw
 * note syntax never travels further into the application than this seam. The
 * adapters' 1-based slide numbers are converted here for the same reason.
 */
const parseSlide = (
  { notes, index, ...slide }: SlideWithSrc,
  knownSpeakers: Iterable<string>,
): StructuredSlide => ({
  ...slide,
  slideIndex: slideIndexFromLegacyNumber(index),
  index: toSlideNumber(index),
  sections: parseNarrationSections(notes, knownSpeakers),
});

export const withSlideSections = (
  result: SlidePptResult,
  knownSpeakers: Iterable<string>,
): StructuredSlideResult =>
  result.success ? { ...result, slide: parseSlide(result.slide, knownSpeakers) } : result;

export const withSlidesSections = (
  result: SlidesPptResult,
  knownSpeakers: Iterable<string>,
): StructuredSlidesResult =>
  result.success
    ? { ...result, slides: result.slides.map((slide) => parseSlide(slide, knownSpeakers)) }
    : result;

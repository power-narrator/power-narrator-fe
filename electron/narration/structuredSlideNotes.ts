import { parseNarrationSections } from "../../shared/narration/NarrationSections.js";
import type {
  StructuredSlide,
  StructuredSlideResult,
  StructuredSlidesResult,
} from "../../shared/types/slides.js";
import type { SlidePptResult, SlidesPptResult, SlideWithSrc } from "../platform/types.js";

/**
 * Notes are parsed here, immediately outside the PowerPoint adapters, so raw
 * note syntax never travels further into the application than this seam.
 */
const parseSlide = (
  { notes, slideIndex, sectionsPlayingAcrossSlides, ...slide }: SlideWithSrc,
  knownSpeakers: Iterable<string>,
): StructuredSlide => ({
  ...slide,
  slideIndex,
  sections: parseNarrationSections(notes, knownSpeakers).map((section, sectionIndex) => ({
    ...section,
    playAcrossSlides: sectionsPlayingAcrossSlides.has(sectionIndex),
  })),
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

import type { NarrationSection } from "../narration/NarrationSections.js";
import type { SlideIndex } from "../slides/slideCoordinates.js";
import type { Result } from "./result.js";

/**
 * A slide as the application works with it: its notes already parsed, so raw
 * note syntax stops at the PowerPoint seam.
 */
export type StructuredSlide = {
  slideIndex: SlideIndex;
  preview: SlidePreview | null;
  sections: NarrationSection[];
};

/** An exported slide image and the URL the viewer loads it from. */
export type SlidePreview = {
  image: string;
  src: string;
};

export type StructuredSlidesResult = Result<{ slides: StructuredSlide[] }>;

export type StructuredSlideResult = Result<{ slide: StructuredSlide }>;

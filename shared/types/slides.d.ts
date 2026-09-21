import type { NarrationSection } from "../narration/NarrationSections.js";
import type { SlideIndex } from "../slides/slideCoordinates.js";
import type { Result } from "./result.js";

/**
 * A slide as the application works with it: its notes already parsed, so raw
 * note syntax stops at the PowerPoint seam.
 */
export interface StructuredSlide {
  /** Where this slide sits in its presentation, whatever collection carries it. */
  slideIndex: SlideIndex;
  image: string;
  src: string;
  sections: NarrationSection[];
}

export type StructuredSlidesResult = Result<{ slides: StructuredSlide[] }>;

export type StructuredSlideResult = Result<{ slide: StructuredSlide }>;

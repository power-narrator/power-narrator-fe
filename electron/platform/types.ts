import type { SlideIndex } from "../../shared/slides/slideCoordinates.js";
import type { ErrorResult, Result, SuccessResult } from "../../shared/types/result.js";

export type { ErrorResult, Result, SuccessResult };
export type {
  StructuredSlide,
  StructuredSlideResult,
  StructuredSlidesResult,
} from "../../shared/types/slides.js";
export type {
  BasicPptResult,
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  VideoPptResult,
} from "../../shared/types/powerpoint.js";

/** Zero-based section indices whose audio is set to play across slides. */
export type SectionsPlayingAcrossSlides = ReadonlySet<number>;

export type SlideManifestEntry = {
  slideIndex: SlideIndex;
  image: string;
  notes: string;
  sectionsPlayingAcrossSlides: SectionsPlayingAcrossSlides;
};

export type SlideNotesEntry = {
  slideIndex: SlideIndex;
  notes: string;
};

export type SlideWithSrc = SlideManifestEntry & {
  src: string;
};

/**
 * Slide images keyed by presentation-wide slide index, so a partial or
 * reordered export still says which slide each image belongs to.
 */
export type SlideImageMap = ReadonlyMap<SlideIndex, { image: string }>;

export type SlideNotesMap = ReadonlyMap<SlideIndex, string>;

export type SlideAudioEntry = {
  slideIndex: SlideIndex;
  sectionIndex: number;
  audioData: Uint8Array;
  playAcrossSlides: boolean;
};

export type SlidesPptResult = Result<{ slides: SlideWithSrc[] }>;

export type SlidePptResult = Result<{ slide: SlideWithSrc }>;

export type ExportSlideImagesResult = Result<{ images: SlideImageMap }>;

export type ReloadSlideImageResult = Result<{ image: string }>;

export type ReadAllSlideNotesResult = Result<{ notes: SlideNotesMap }>;

export type ReadSlideNotesResult = Result<{ notes: string }>;

export type ReadSlideContentResult = Result<{
  notes: string;
  sectionsPlayingAcrossSlides: SectionsPlayingAcrossSlides;
}>;

export type XmlSlideAudio = {
  name: string;
};

export type XmlSlideData = {
  notes: string;
  audio: XmlSlideAudio[];
};

export type XmlCliOperationName =
  | "get_slides"
  | "set_slide_notes"
  | "save_audio_for_slide"
  | "delete_audio_for_slide";

export type XmlCliOperation = {
  op: XmlCliOperationName;
  args: Record<string, string | number>;
};

export type XmlCliOperationResult = {
  success: boolean;
  result: unknown;
  message: string;
};

export type XmlCliResponse = {
  results: XmlCliOperationResult[];
};

export type RunXmlCliResult = Result<{ data: XmlCliResponse }>;

export type QuerySlidesResult = Result<{ slideData: XmlSlideData[] }>;

import type { SlideIndex } from "../../shared/slides/slideCoordinates.js";
import type {
  BasicPptResult,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlideNarrationEntry,
  SlideNarrationSaveResult,
  SlidePptResult,
  SlidesPptResult,
  VideoPptResult,
} from "./types.js";

export type PptProvider = {
  convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult>;
  /**
   * Writes the slide's notes and makes its audio entries its complete section
   * audio: any other section audio on that slide is obsolete and removed, while
   * other media and slides are left alone. A failure says what it left saved.
   */
  saveSlideNarration(
    filePath: string,
    slide: SlideNarrationEntry,
  ): Promise<SlideNarrationSaveResult>;
  removeAudio(filePath: string, slideIndices: SlideIndex[]): Promise<BasicPptResult>;
  readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult>;
  readSlideNotes(filePath: string, slideIndex: SlideIndex): Promise<ReadSlideNotesResult>;
  reloadSlide(filePath: string, slideIndex: SlideIndex, outputDir: string): Promise<SlidePptResult>;
};

export type NativePlatformProvider = {
  generateVideo(filePath: string, videoOutputPath: string): Promise<VideoPptResult>;
  playSlide(filePath: string, slideIndex: SlideIndex): Promise<BasicPptResult>;
  exportSlideImages(filePath: string, outputDir: string): Promise<ExportSlideImagesResult>;
  reloadSlideImage(
    filePath: string,
    slideIndex: SlideIndex,
    outputDir: string,
  ): Promise<ReloadSlideImageResult>;
  /** Resolves to the slide the author was on, defaulting to the first slide. */
  closePresentation(filePath: string): Promise<SlideIndex>;
  reopenPresentation(filePath: string, slideIndex: SlideIndex): Promise<void>;
};

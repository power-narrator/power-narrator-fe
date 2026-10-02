import type { SlideIndex } from "../../shared/slides/slideCoordinates.js";
import type {
  BasicPptResult,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlidePptResult,
  SlideAudioEntry,
  SlideNotesEntry,
  SlidesPptResult,
  VideoPptResult,
} from "./types.js";

export type PptProvider = {
  convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult>;
  insertAudio(filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult>;
  removeAudio(filePath: string, slideIndices: SlideIndex[]): Promise<BasicPptResult>;
  readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult>;
  readSlideNotes(filePath: string, slideIndex: SlideIndex): Promise<ReadSlideNotesResult>;
  saveNotes(filePath: string, slides: SlideNotesEntry[]): Promise<BasicPptResult>;
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

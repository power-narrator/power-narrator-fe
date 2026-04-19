import type {
  BasicPptResult,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlidePptResult,
  SlideAudioEntry,
  SlideManifestEntry,
  SlidesPptResult,
  VideoPptResult,
} from "./types.js";

export interface PptProvider {
  convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult>;
  insertAudio(filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult>;
  removeAudio(filePath: string, slideIndices: number[]): Promise<BasicPptResult>;
  saveNotes(filePath: string, slides: SlideManifestEntry[]): Promise<BasicPptResult>;
  reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<SlidePptResult>;
}

export interface NativePlatformProvider {
  generateVideo(filePath: string, videoOutputPath: string): Promise<VideoPptResult>;
  playSlide(filePath: string, slideIndex: number): Promise<BasicPptResult>;
  exportSlideImages(filePath: string, outputDir: string): Promise<ExportSlideImagesResult>;
  reloadSlideImage(
    filePath: string,
    slideIndex: number,
    outputDir: string,
  ): Promise<ReloadSlideImageResult>;
  closePresentation(filePath: string): Promise<number>;
  reopenPresentation(filePath: string, slideIndex: number): Promise<void>;
}

export interface MacPptProviderContract extends PptProvider, NativePlatformProvider {
  readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult>;
  readSlideNotes(filePath: string, slideIndex: number): Promise<ReadSlideNotesResult>;
}

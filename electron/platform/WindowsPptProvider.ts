import type { NativePlatformProvider, PptProvider } from "./PptProvider.js";
import type {
  BasicPptResult,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlideAudioEntry,
  SlideNotesEntry,
  SlidePptResult,
  SlidesPptResult,
  VideoPptResult,
} from "./types.js";

export class WindowsPptProvider implements PptProvider, NativePlatformProvider {
  convertPptx(_filePath: string, _outputDir: string): Promise<SlidesPptResult> {
    return Promise.resolve({ success: false, message: "convertPptx not supported on Windows yet" });
  }

  insertAudio(_filePath: string, _slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
    return Promise.resolve({ success: false, message: "insertAudio not supported on Windows yet" });
  }

  removeAudio(_filePath: string, _slideIndices: number[]): Promise<BasicPptResult> {
    return Promise.resolve({ success: false, message: "removeAudio not supported on Windows yet" });
  }

  saveNotes(_filePath: string, _slides: SlideNotesEntry[]): Promise<BasicPptResult> {
    return Promise.resolve({ success: false, message: "saveNotes not supported on Windows yet" });
  }

  generateVideo(_filePath: string, _videoOutputPath: string): Promise<VideoPptResult> {
    return Promise.resolve({
      success: false,
      message: "generateVideo not supported on Windows yet",
    });
  }

  playSlide(_filePath: string, _slideIndex: number): Promise<BasicPptResult> {
    return Promise.resolve({ success: false, message: "playSlide not supported on Windows yet" });
  }

  exportSlideImages(_filePath: string, _outputDir: string): Promise<ExportSlideImagesResult> {
    return Promise.resolve({
      success: false,
      message: "exportSlideImages not supported on Windows yet",
    });
  }

  reloadSlideImage(
    _filePath: string,
    _slideIndex: number,
    _outputDir: string,
  ): Promise<ReloadSlideImageResult> {
    return Promise.resolve({
      success: false,
      message: "reloadSlideImage not supported on Windows yet",
    });
  }

  closePresentation(_filePath: string): Promise<number> {
    return Promise.resolve(1);
  }

  reopenPresentation(_filePath: string, _slideIndex: number): Promise<void> {
    return Promise.resolve();
  }

  readAllSlideNotes(_filePath: string): Promise<ReadAllSlideNotesResult> {
    return Promise.resolve({
      success: false,
      message: "readAllSlideNotes not supported on Windows yet",
    });
  }

  readSlideNotes(_filePath: string, _slideIndex: number): Promise<ReadSlideNotesResult> {
    return Promise.resolve({
      success: false,
      message: "readSlideNotes not supported on Windows yet",
    });
  }

  reloadSlide(_filePath: string, _slideIndex: number, _outputDir: string): Promise<SlidePptResult> {
    return Promise.resolve({ success: false, message: "reloadSlide not supported on Windows yet" });
  }
}

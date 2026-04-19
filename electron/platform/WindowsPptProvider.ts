import { NativePlatformProvider, PptProvider } from "./PptProvider.js";
import type {
  BasicPptResult,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlideAudioEntry,
  SlideManifestEntry,
  SlidePptResult,
  SlidesPptResult,
  VideoPptResult,
} from "./types.js";

export class WindowsPptProvider implements PptProvider, NativePlatformProvider {
  async convertPptx(_filePath: string, _outputDir: string): Promise<SlidesPptResult> {
    return { success: false, message: "convertPptx not supported on Windows yet" };
  }

  async insertAudio(_filePath: string, _slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
    return { success: false, message: "insertAudio not supported on Windows yet" };
  }

  async removeAudio(_filePath: string, _slideIndices: number[]): Promise<BasicPptResult> {
    return { success: false, message: "removeAudio not supported on Windows yet" };
  }

  async saveNotes(_filePath: string, _slides: SlideManifestEntry[]): Promise<BasicPptResult> {
    return { success: false, message: "saveNotes not supported on Windows yet" };
  }

  async generateVideo(_filePath: string, _videoOutputPath: string): Promise<VideoPptResult> {
    return { success: false, message: "generateVideo not supported on Windows yet" };
  }

  async playSlide(_filePath: string, _slideIndex: number): Promise<BasicPptResult> {
    return { success: false, message: "playSlide not supported on Windows yet" };
  }

  async exportSlideImages(_filePath: string, _outputDir: string): Promise<ExportSlideImagesResult> {
    return { success: false, message: "exportSlideImages not supported on Windows yet" };
  }

  async reloadSlideImage(
    _filePath: string,
    _slideIndex: number,
    _outputDir: string,
  ): Promise<ReloadSlideImageResult> {
    return { success: false, message: "reloadSlideImage not supported on Windows yet" };
  }

  async closePresentation(_filePath: string): Promise<number> {
    return 1;
  }

  async reopenPresentation(_filePath: string, _slideIndex: number): Promise<void> {
    return;
  }

  async readAllSlideNotes(_filePath: string): Promise<ReadAllSlideNotesResult> {
    return { success: false, message: "readAllSlideNotes not supported on Windows yet" };
  }

  async readSlideNotes(_filePath: string, _slideIndex: number): Promise<ReadSlideNotesResult> {
    return { success: false, message: "readSlideNotes not supported on Windows yet" };
  }

  async reloadSlide(
    _filePath: string,
    _slideIndex: number,
    _outputDir: string,
  ): Promise<SlidePptResult> {
    return { success: false, message: "reloadSlide not supported on Windows yet" };
  }
}

import { MacPptProviderContract } from './PptProvider.js';
import type {
    BasicPptResult,
    ExportSlideImagesResult,
    ReadAllSlideNotesResult,
    ReadSlideNotesResult,
    ReloadSlideImageResult,
    RemoveAudioScope,
    SlideAudioEntry,
    SlideManifestEntry,
    SlidesPptResult,
    VideoPptResult,
} from './types.js';

export class WindowsPptProvider implements MacPptProviderContract {
    async convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult> {
        return { success: false, message: 'convertPptx not supported on Windows yet' };
    }

    async insertAudio(filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
        return { success: false, message: 'insertAudio not supported on Windows yet' };
    }

    async removeAudio(filePath: string, scope: RemoveAudioScope, slideIndex: number): Promise<BasicPptResult> {
        return { success: false, message: 'removeAudio not supported on Windows yet' };
    }

    async saveAllNotes(filePath: string, slides: SlideManifestEntry[]): Promise<BasicPptResult> {
        return { success: false, message: 'saveAllNotes not supported on Windows yet' };
    }

    async generateVideo(filePath: string, videoOutputPath: string): Promise<VideoPptResult> {
        return { success: false, message: 'generateVideo not supported on Windows yet' };
    }

    async playSlide(filePath: string, slideIndex: number): Promise<BasicPptResult> {
        return { success: false, message: 'playSlide not supported on Windows yet' };
    }

    async exportSlideImages(filePath: string, outputDir: string): Promise<ExportSlideImagesResult> {
        return { success: false, message: 'exportSlideImages not supported on Windows yet' };
    }

    async reloadSlideImage(filePath: string, slideIndex: number, outputDir: string): Promise<ReloadSlideImageResult> {
        return { success: false, message: 'reloadSlideImage not supported on Windows yet' };
    }

    async closePresentation(filePath: string): Promise<number> {
        return 1;
    }

    async reopenPresentation(filePath: string, slideIndex: number): Promise<void> {
        return;
    }

    async readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult> {
        return { success: false, message: 'readAllSlideNotes not supported on Windows yet' };
    }

    async readSlideNotes(filePath: string, slideIndex: number): Promise<ReadSlideNotesResult> {
        return { success: false, message: 'readSlideNotes not supported on Windows yet' };
    }

    async reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<SlidesPptResult> {
        return { success: false, message: 'reloadSlide not supported on Windows yet' };
    }
}

import { PptProvider } from './PptProvider.js';

export class WindowsPptProvider implements PptProvider {
    async convertPptx(filePath: string, outputDir: string): Promise<any> {
        return { success: false, error: 'convertPptx not supported on Windows yet' };
    }

    async insertAudio(filePath: string, slidesAudio: any[]): Promise<any> {
        return { success: false, error: 'insertAudio not supported on Windows yet' };
    }

    async removeAudio(filePath: string, scope: string, slideIndex: number): Promise<any> {
        return { success: false, error: 'removeAudio not supported on Windows yet' };
    }

    async saveAllNotes(filePath: string, slides: any[], slidesAudio: any[]): Promise<any> {
        return { success: false, error: 'saveAllNotes not supported on Windows yet' };
    }

    async generateVideo(filePath: string, videoOutputPath: string): Promise<any> {
        return { success: false, error: 'generateVideo not supported on Windows yet' };
    }

    async playSlide(slideIndex: number): Promise<any> {
        return { success: false, error: 'playSlide not supported on Windows yet' };
    }

    async reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<any> {
        return { success: false, error: 'reloadSlide not supported on Windows yet' };
    }
}

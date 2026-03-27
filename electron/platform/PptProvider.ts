export interface PptProvider {
    closePresentation?(filePath: string): Promise<number>;
    reopenPresentation?(filePath: string, slideIndex: number): Promise<void>;
    
    convertPptx(filePath: string, outputDir: string): Promise<any>;
    insertAudio(filePath: string, slidesAudio: any[]): Promise<any>;
    removeAudio(filePath: string, scope: string, slideIndex: number): Promise<any>;
    saveAllNotes(filePath: string, slides: any[], slidesAudio: any[]): Promise<any>;
    generateVideo(filePath: string, videoOutputPath: string): Promise<any>;
    playSlide(slideIndex: number): Promise<any>;
    syncSlide(filePath: string, slideIndex: number, outputDir: string): Promise<any>;
}

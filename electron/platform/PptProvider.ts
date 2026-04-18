export interface PptProvider {
    closePresentation?(filePath: string): Promise<number>;
    reopenPresentation?(filePath: string, slideIndex: number): Promise<void>;
    exportSlideImages?(filePath: string, outputDir: string): Promise<any>;
    reloadSlideImage?(filePath: string, slideIndex: number, outputDir: string): Promise<any>;
    readAllSlideNotes?(filePath: string): Promise<any>;
    readSlideNotes?(filePath: string, slideIndex: number): Promise<any>;
    
    convertPptx(filePath: string, outputDir: string): Promise<any>;
    insertAudio(filePath: string, slidesAudio: any[]): Promise<any>;
    removeAudio(filePath: string, scope: string, slideIndex: number): Promise<any>;
    saveAllNotes(filePath: string, slides: any[]): Promise<any>;
    generateVideo(filePath: string, videoOutputPath: string): Promise<any>;
    playSlide(filePath: string, slideIndex: number): Promise<any>;
    reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<any>;
}

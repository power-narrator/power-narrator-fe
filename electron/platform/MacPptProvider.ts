import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { PptProvider } from './PptProvider.js';
import { resolveScriptPath, resolveSlideAssetUrl } from './helpers.js';

type SlideImageMap = Record<number, { image: string }>;
type SlideNotesMap = Record<number, string>;
type AppleScriptResult<T = Record<string, unknown>> = {
    success: boolean;
    data?: T;
    error?: string;
};

/**
 * MacPptProvider
 *
 * Provides macOS-specific implementations for interacting with Microsoft PowerPoint
 * via AppleScript (osascript).
 */
export class MacPptProvider implements PptProvider {
    constructor() {
        this.cleanup();
    }

    private getOfficeContainerPath(): string {
        return path.join(app.getPath('home'), 'Library/Group Containers/UBF8T346G9.Office');
    }

    private normalizeNotes(notes: string): string {
        return notes.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    private buildSlidesWithPaths(slides: any[], outputDir: string): any[] {
        const timestamp = Date.now();

        return slides.map((s: any) => ({
            ...s,
            src: s.image ? `${resolveSlideAssetUrl(path.join(outputDir, s.image))}?t=${timestamp}` : null,
            notes: this.normalizeNotes(s.notes || ''),
        })).filter((s: any) => s.src !== null);
    }

    private mergeSlideData(images: SlideImageMap, notes: SlideNotesMap): any[] {
        return Object.keys(images)
            .map((index) => Number(index))
            .sort((a, b) => a - b)
            .map((index) => ({
                index,
                image: images[index]?.image || '',
                notes: notes[index] || '',
            }));
    }

    private loadManifest(manifestPath: string): any[] {
        const manifestData = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(manifestData);
    }

    private writeManifest(manifestPath: string, slides: any[]): void {
        fs.writeFileSync(manifestPath, JSON.stringify(slides, null, 2), 'utf8');
    }

    private readImageManifest(manifestPath: string): SlideImageMap {
        const slides = this.loadManifest(manifestPath);
        const images: SlideImageMap = {};

        for (const slide of slides) {
            if (typeof slide.index === 'number') {
                images[slide.index] = { image: slide.image || '' };
            }
        }

        return images;
    }

    private parseNotesExportFile(filePath: string): SlideNotesMap {
        const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
        const lines = content.split(/\r\n|\n|\r/);
        const notes: SlideNotesMap = {};
        let currentSlideIndex: number | null = null;
        let currentLines: string[] = [];

        for (const line of lines) {
            if (line.startsWith('###SLIDE_START### ')) {
                currentSlideIndex = Number(line.slice('###SLIDE_START### '.length));
                currentLines = [];
                continue;
            }

            if (line === '###SLIDE_END###') {
                if (currentSlideIndex !== null && !Number.isNaN(currentSlideIndex)) {
                    notes[currentSlideIndex] = this.normalizeNotes(currentLines.join('\n'));
                }
                currentSlideIndex = null;
                currentLines = [];
                continue;
            }

            if (currentSlideIndex !== null) {
                currentLines.push(line);
            }
        }

        return notes;
    }

    private parseAppleScriptJson<T = Record<string, unknown>>(stdout: string): AppleScriptResult<T> {
        const trimmed = stdout.trim();
        if (!trimmed) {
            return { success: false, error: 'AppleScript returned no output.' };
        }

        try {
            return JSON.parse(trimmed) as AppleScriptResult<T>;
        } catch (error: any) {
            return { success: false, error: `Failed to parse AppleScript JSON: ${error.message}` };
        }
    }

    private runAppleScriptJson<T = Record<string, unknown>>(scriptName: string, args: string[]): Promise<AppleScriptResult<T>> {
        return new Promise((resolve) => {
            const scriptPath = resolveScriptPath(scriptName);
            const child = spawn('osascript', [scriptPath, ...args]);

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: any) => { stdout += data.toString(); });
            child.stderr.on('data', (data: any) => { stderr += data.toString(); });

            child.on('close', (code: number) => {
                const parsed = this.parseAppleScriptJson<T>(stdout);
                if (parsed.success || stdout.trim()) {
                    if (!parsed.success && stderr.trim() && !parsed.error) {
                        parsed.error = stderr.trim();
                    }
                    resolve(parsed);
                    return;
                }

                if (code !== 0) {
                    resolve({ success: false, error: stderr.trim() || `AppleScript failed with code ${code}.` });
                    return;
                }

                resolve(parsed);
            });

            child.on('error', (error: any) => {
                resolve({ success: false, error: `Failed to start AppleScript: ${error.message}` });
            });
        });
    }

    private async runMacro(macroName: string, filePath: string): Promise<AppleScriptResult> {
        return this.runAppleScriptJson('trigger-macro.applescript', [macroName, filePath]);
    }

    /**
     * Programmatically returns focus to the Electron window.
     */
    private focusApp(): void {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].show();
            windows[0].focus();
        }
    }

    /**
     * Clears all temporary audio session data from the Office Container.
     */
    private cleanup(): void {
        try {
            const officeContainer = this.getOfficeContainerPath();
            const tempAudioDir = path.join(officeContainer, 'TemporaryAudio');
            fs.rmSync(tempAudioDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Cleanup failed:', e);
        }
    }

    /**
     * Closes the currently active PowerPoint presentation.
     *
     * @param filePath - The path to the PowerPoint file to close.
     * @returns A promise resolving to the slide index the user was on before closing, or 1 if it fails.
     */
    async closePresentation(filePath: string): Promise<number> {
        try {
            const closeScript = resolveScriptPath('close-presentation.applescript');
            const childClose = spawn('osascript', [closeScript, filePath]);
            const slideIndex = await new Promise<number>((resolve) => {
                let out = '';
                childClose.stdout.on('data', (d: any) => out += d.toString());
                childClose.on('close', () => {
                    const parsed = parseInt(out.trim(), 10);
                    resolve(isNaN(parsed) ? 1 : parsed);
                });
            });
            return slideIndex;
        } catch (e) {
            console.error('Failed to close presentation', e);
            return 1;
        }
    }

    /**
     * Reopens a presentation and navigates to the specified slide index.
     *
     * @param filePath - The path to the PowerPoint file to open.
     * @param slideIndex - The slide index to navigate to.
     */
    async reopenPresentation(filePath: string, slideIndex: number): Promise<void> {
        try {
            const reopenScript = resolveScriptPath('reopen-presentation.applescript');
            const childReopen = spawn('osascript', [reopenScript, filePath, slideIndex.toString()]);
            await new Promise<void>((resolve) => {
                childReopen.on('close', () => resolve());
            });
        } catch (e) {
            console.error('Failed to reopen presentation', e);
        }

        this.focusApp();
    }

    async exportSlideImages(filePath: string, outputDir: string): Promise<any> {
        const tempDir = app.getPath('temp');
        fs.mkdirSync(path.join(tempDir, 'power-narrator'), { recursive: true });

        try {
            const scriptResult = await this.runAppleScriptJson<{ manifestPath?: string }>('convert-pptx.applescript', [filePath, outputDir]);
            if (!scriptResult.success) {
                return { success: false, error: scriptResult.error || 'Image export failed.' };
            }

            const manifestPath = scriptResult.data?.manifestPath;
            if (!manifestPath) {
                return { success: false, error: 'AppleScript did not return a manifest path.' };
            }

            const images = this.readImageManifest(manifestPath);
            return { success: true, images };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    async reloadSlideImage(filePath: string, slideIndex: number, outputDir: string): Promise<any> {
        const imageResult = await this.exportSlideImages(filePath, outputDir);
        if (!imageResult.success) {
            return imageResult;
        }

        const image = imageResult.images?.[slideIndex]?.image;
        if (!image) {
            return { success: false, error: `Could not find exported image for slide ${slideIndex}` };
        }

        return { success: true, image };
    }

    async readAllSlideNotes(filePath: string): Promise<any> {
        const officeContainer = this.getOfficeContainerPath();
        const paramsPath = path.join(officeContainer, 'export_all_notes_params.txt');
        const outputPath = path.join(officeContainer, `export_all_notes_${Date.now()}.txt`);

        try {
            fs.writeFileSync(paramsPath, `${filePath}|${outputPath}`, 'utf8');
            const scriptResult = await this.runMacro('ExportAllSlideNotes', filePath);
            if (!scriptResult.success) {
                return { success: false, error: scriptResult.error || 'Failed to export slide notes.' };
            }

            const notes = this.parseNotesExportFile(outputPath);
            return { success: true, notes };
        } catch (e: any) {
            try { fs.unlinkSync(paramsPath); } catch (err) { }
            try { fs.unlinkSync(outputPath); } catch (err) { }
            return { success: false, error: e.message };
        } finally {
            try { fs.unlinkSync(paramsPath); } catch (e) { }
            try { fs.unlinkSync(outputPath); } catch (e) { }
        }
    }

    async readSlideNotes(filePath: string, slideIndex: number): Promise<any> {
        const officeContainer = this.getOfficeContainerPath();
        const paramsPath = path.join(officeContainer, 'export_slide_notes_params.txt');
        const outputPath = path.join(officeContainer, `export_slide_notes_${Date.now()}.txt`);

        try {
            fs.writeFileSync(paramsPath, `${filePath}|${slideIndex}|${outputPath}`, 'utf8');
            const scriptResult = await this.runMacro('ExportSlideNotes', filePath);
            if (!scriptResult.success) {
                return { success: false, error: scriptResult.error || 'Failed to export slide notes.' };
            }

            const notes = this.parseNotesExportFile(outputPath);
            return { success: true, notes: notes[slideIndex] || '' };
        } catch (e: any) {
            try { fs.unlinkSync(paramsPath); } catch (err) { }
            try { fs.unlinkSync(outputPath); } catch (err) { }
            return { success: false, error: e.message };
        } finally {
            try { fs.unlinkSync(paramsPath); } catch (e) { }
            try { fs.unlinkSync(outputPath); } catch (e) { }
        }
    }

    /**
     * Extracts images and notes from a PowerPoint presentation into an output directory.
     *
     * @param filePath - The path to the PowerPoint file to convert.
     * @param outputDir - The directory where the extracted assets should be saved.
     * @returns A promise resolving to the conversion success status and extracted slide data.
     */
    async convertPptx(filePath: string, outputDir: string): Promise<any> {
        const imageResult = await this.exportSlideImages(filePath, outputDir);
        if (!imageResult.success) {
            return imageResult;
        }

        const notesResult = await this.readAllSlideNotes(filePath);
        if (!notesResult.success) {
            return notesResult;
        }

        try {
            const slides = this.mergeSlideData(imageResult.images, notesResult.notes);
            const manifestPath = path.join(outputDir, 'manifest.json');
            this.writeManifest(manifestPath, slides);

            this.focusApp();
            return { success: true, slides: this.buildSlidesWithPaths(slides, outputDir) };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Inserts audio into the specified slides using a VBA macro triggered via AppleScript.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slidesAudio - An array containing objects with audio data and target slide indices.
     * @returns A promise resolving to the success status of the operation.
     */
    async insertAudio(filePath: string, slidesAudio: any[]): Promise<any> {
        if (!slidesAudio || slidesAudio.length === 0) return { success: true };

        const officeContainer = this.getOfficeContainerPath();
        const audioSessionDir = path.join(officeContainer, 'TemporaryAudio', `session-${Date.now()}`);

        try {
            fs.mkdirSync(audioSessionDir, { recursive: true });
        } catch (e) {
            return { success: false, error: 'Could not create audio directory in Office container.' };
        }

        try {
            let batchParams = '';
            for (const slide of slidesAudio) {
                const buffer = Buffer.from(slide.audioData);
                const slideDir = path.join(audioSessionDir, `slide_${slide.index}`);
                fs.mkdirSync(slideDir, { recursive: true });
                const audioFileName = slide.sectionIndex !== undefined ? `ppt_audio_${slide.sectionIndex + 1}.mp3` : 'ppt_audio_1.mp3';
                const audioFilePath = path.join(slideDir, audioFileName);

                fs.writeFileSync(audioFilePath, buffer);
                batchParams += `${filePath}|${slide.index}|${audioFilePath}\n`;
            }

            const paramsPath = path.join(officeContainer, 'insert_audio_params.txt');
            fs.writeFileSync(paramsPath, batchParams, 'utf8');

            const scriptResult = await this.runMacro('InsertAudio', filePath);
            if (!scriptResult.success) {
                return { success: false, error: scriptResult.error || 'Failed to insert audio.' };
            }

            this.focusApp();

            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        } finally {
            try { fs.unlinkSync(path.join(officeContainer, 'insert_audio_params.txt')); } catch (e) { }
            try { fs.rmSync(audioSessionDir, { recursive: true, force: true }); } catch (e) { }
        }
    }

    /**
     * Removes audio from the specified scope (entire presentation or a specific slide).
     *
     * @param filePath - The path to the PowerPoint file.
     * @param scope - The scope to remove audio from (e.g., "all", "slide").
     * @param slideIndex - The target slide index (required if scope is "slide").
     * @returns A promise resolving to the success status of the operation.
     */
    async removeAudio(filePath: string, scope: string, slideIndex: number): Promise<any> {
        const officeContainer = this.getOfficeContainerPath();
        const paramsPath = path.join(officeContainer, 'remove_audio_params.txt');

        try {
            const paramsContent = `${filePath}|${scope}|${slideIndex || 0}`;
            fs.writeFileSync(paramsPath, paramsContent, 'utf8');

            const scriptResult = await this.runMacro('RemoveAudio', filePath);
            if (!scriptResult.success) {
                return { success: false, error: scriptResult.error || 'Failed to remove audio.' };
            }

            this.focusApp();
            return { success: true };
        } finally {
            try { fs.unlinkSync(paramsPath); } catch (e) { }
        }
    }

    /**
     * Updates speaker notes for the specified slides using a VBA macro.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slides - An array of slide objects containing updated notes.
     * @returns A promise resolving to the success status of the operation.
     */
    async saveAllNotes(filePath: string, slides: any[]): Promise<any> {
        const officeContainer = this.getOfficeContainerPath();

        let dataContent = '';
        for (const s of slides) {
            if (s.notes) {
                dataContent += `###SLIDE_START### ${s.index}\n${s.notes}\n###SLIDE_END###\n`;
            }
        }

        const dataPath = path.join(officeContainer, `notes_data_${Date.now()}.txt`);
        fs.writeFileSync(dataPath, dataContent, 'utf8');

        const paramsPath = path.join(officeContainer, 'update_notes_params.txt');
        const paramsContent = `${filePath}|${dataPath}`;
        fs.writeFileSync(paramsPath, paramsContent, 'utf8');

        try {
            const scriptResult = await this.runMacro('UpdateNotes', filePath);
            if (!scriptResult.success) {
                return { success: false, error: scriptResult.error || 'Failed to update notes.' };
            }

            this.focusApp();
            return { success: true };
        } finally {
            try { fs.unlinkSync(dataPath); } catch (e) { }
            try { fs.unlinkSync(paramsPath); } catch (e) { }
        }
    }

    /**
     * Exports the PowerPoint presentation to a video file.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param videoOutputPath - The target path for the generated video file.
     * @returns A promise resolving to the success status and the output path.
     */
    async generateVideo(filePath: string, videoOutputPath: string): Promise<any> {
        try {
            const exportScriptPath = resolveScriptPath('export-to-video.applescript');
            const child = spawn('osascript', [exportScriptPath, videoOutputPath, filePath]);

            await new Promise<void>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: any) => stdout += d);
                child.stderr.on('data', (d: any) => stderr += d);
                child.on('close', (code: number) => {
                    if (code === 0 && !stdout.includes('Error')) {
                        this.focusApp();
                        resolve();
                    } else {
                        reject(new Error(stdout || stderr));
                    }
                });
            });
            return { success: true, outputPath: videoOutputPath };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Enters presentation mode and navigates to the specified slide.
     *
     * @param slideIndex - The index of the slide to start playing from.
     * @returns A promise resolving to the success status.
     */
    async playSlide(filePath: string, slideIndex: number): Promise<any> {
        const scriptPath = resolveScriptPath('play-slide.applescript');
        return new Promise((resolve) => {
            const child = spawn('osascript', [scriptPath, slideIndex.toString(), filePath]);
            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => output += data.toString());
            child.stderr.on('data', (data) => errorOutput += data.toString());

            child.on('close', (code) => {
                if (code === 0) {
                    if (output.includes('Error')) resolve({ success: false, error: output.trim() });
                    else resolve({ success: true });
                } else {
                    resolve({ success: false, error: errorOutput || 'Unknown error playing slide' });
                }
            });
        });
    }

    /**
     * Reloads an individual slide by re-exporting its image and fetching its notes.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slideIndex - The index of the slide to reload.
     * @param outputDir - The directory where the reloaded slide assets should be updated.
     * @returns A promise resolving to the fresh set of slides or an error message.
     */
    async reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<any> {
        const imageResult = await this.reloadSlideImage(filePath, slideIndex, outputDir);
        if (!imageResult.success) {
            return imageResult;
        }

        const notesResult = await this.readSlideNotes(filePath, slideIndex);
        if (!notesResult.success) {
            return notesResult;
        }

        try {
            const manifestPath = path.join(outputDir, 'manifest.json');
            const slides = this.loadManifest(manifestPath);
            const slide = slides.find((entry: any) => entry.index === slideIndex);

            if (slide) {
                slide.image = imageResult.image;
                slide.notes = notesResult.notes;
            } else {
                slides.push({ index: slideIndex, image: imageResult.image, notes: notesResult.notes });
                slides.sort((a: any, b: any) => a.index - b.index);
            }

            this.writeManifest(manifestPath, slides);

            this.focusApp();
            return { success: true, slides: this.buildSlidesWithPaths(slides, outputDir) };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
}

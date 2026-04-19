import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { MacPptProviderContract } from './PptProvider.js';
import { getErrorMessage } from './errors.js';
import {
    APP_NAME,
    buildSlidesWithPaths,
    buildPptAudioFileName,
    cleanupPaths,
    normalizeNotes,
    resolveScriptPath,
} from './helpers.js';
import type {
    BasicPptResult,
    ExportSlideImagesResult,
    ReadAllSlideNotesResult,
    ReadSlideNotesResult,
    ReloadSlideImageResult,
    SlideAudioEntry,
    SlideImageMap,
    SlideManifestEntry,
    SlideNotesMap,
    SlidePptResult,
    SlidesPptResult,
    VideoPptResult,
} from './types.js';

type AppleScriptJson<T = Record<string, unknown>> = {
    success: true;
    data: T;
} | {
    success: false;
    message?: string;
    error?: string;
};

type AppleScriptResult<T = Record<string, unknown>> = {
    success: true;
    data: T;
} | {
    success: false;
    message: string;
};

/**
 * MacPptProvider
 *
 * Provides macOS-specific implementations for interacting with Microsoft PowerPoint
 * via AppleScript (osascript).
 */
export class MacPptProvider implements MacPptProviderContract {
    constructor() {
        this.cleanup();
    }

    private getOfficeContainerPath(): string {
        return path.join(app.getPath('home'), 'Library/Group Containers/UBF8T346G9.Office');
    }

    private mergeSlideData(images: SlideImageMap, notes: SlideNotesMap): SlideManifestEntry[] {
        return Object.keys(images)
            .map((index) => Number(index))
            .sort((a, b) => a - b)
            .map((index) => ({
                index,
                image: images[index]?.image || '',
                notes: notes[index] || '',
            }));
    }

    private readImageManifest(manifestPath: string): SlideImageMap {
        const slides = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SlideManifestEntry[];
        const images: SlideImageMap = {};

        for (const slide of slides) {
            if (typeof slide.index === 'number') {
                images[slide.index] = { image: slide.image || '' };
            }
        }

        return images;
    }

    private parseNotesExportFile(filePath: string): SlideNotesMap {
        const content = fs.readFileSync(filePath, 'utf8');
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
                    notes[currentSlideIndex] = normalizeNotes(currentLines.join('\n'));
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
            return { success: false, message: 'AppleScript returned no output.' };
        }

        try {
            const parsed = JSON.parse(trimmed) as AppleScriptJson<T>;
            if (parsed.success) {
                return { success: true, data: parsed.data };
            }

            return { success: false, message: parsed.message || parsed.error || 'AppleScript reported failure.' };
        } catch (error: unknown) {
            return { success: false, message: `Failed to parse AppleScript JSON: ${getErrorMessage(error)}` };
        }
    }

    private runAppleScriptJson<T = Record<string, unknown>>(scriptName: string, args: string[]): Promise<AppleScriptResult<T>> {
        return new Promise((resolve) => {
            const scriptPath = resolveScriptPath(scriptName);
            const child = spawn('osascript', [scriptPath, ...args]);

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            child.on('close', (code: number) => {
                const parsed = this.parseAppleScriptJson<T>(stdout);
                if (parsed.success || stdout.trim()) {
                    if (!parsed.success && stderr.trim()) {
                        resolve({ success: false, message: stderr.trim() });
                        return;
                    }

                    resolve(parsed);
                    return;
                }

                if (code !== 0) {
                    resolve({ success: false, message: stderr.trim() || `AppleScript failed with code ${code}.` });
                    return;
                }

                resolve(parsed);
            });

            child.on('error', (error: Error) => {
                resolve({ success: false, message: `Failed to start AppleScript: ${getErrorMessage(error)}` });
            });
        });
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
                childClose.stdout.on('data', (d: Buffer) => out += d.toString());
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

    async exportSlideImages(filePath: string, outputDir: string): Promise<ExportSlideImagesResult> {
        const tempDir = app.getPath('temp');
        fs.mkdirSync(path.join(tempDir, APP_NAME), { recursive: true });

        try {
            const scriptResult = await this.runAppleScriptJson<{ manifestPath: string }>('convert-pptx.applescript', [filePath, outputDir]);
            if (!scriptResult.success) {
                return { success: false, message: scriptResult.message || 'Image export failed.' };
            }

            const manifestPath = scriptResult.data.manifestPath;

            const images = this.readImageManifest(manifestPath);
            return { success: true, images };
        } catch (err: unknown) {
            return { success: false, message: getErrorMessage(err) };
        }
    }

    async reloadSlideImage(filePath: string, slideIndex: number, outputDir: string): Promise<ReloadSlideImageResult> {
        const imageResult = await this.exportSlideImages(filePath, outputDir);
        if (!imageResult.success) {
            return imageResult;
        }

        const image = imageResult.images?.[slideIndex]?.image;
        if (!image) {
            return { success: false, message: `Could not find exported image for slide ${slideIndex}` };
        }

        return { success: true, image };
    }

    async readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult> {
        const officeContainer = this.getOfficeContainerPath();
        const paramsPath = path.join(officeContainer, 'export_all_notes_params.txt');
        const outputPath = path.join(officeContainer, `export_all_notes_${Date.now()}.txt`);

        try {
            fs.writeFileSync(paramsPath, `${filePath}|${outputPath}`, 'utf8');
            const scriptResult = await this.runAppleScriptJson('trigger-macro.applescript', ['ExportAllSlideNotes', filePath]);
            if (!scriptResult.success) {
                return { success: false, message: scriptResult.message || 'Failed to export slide notes.' };
            }

            const notes = this.parseNotesExportFile(outputPath);
            return { success: true, notes };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        } finally {
            cleanupPaths(paramsPath, outputPath);
        }
    }

    async readSlideNotes(filePath: string, slideIndex: number): Promise<ReadSlideNotesResult> {
        const officeContainer = this.getOfficeContainerPath();
        const paramsPath = path.join(officeContainer, 'export_slide_notes_params.txt');
        const outputPath = path.join(officeContainer, `export_slide_notes_${Date.now()}.txt`);

        try {
            fs.writeFileSync(paramsPath, `${filePath}|${slideIndex}|${outputPath}`, 'utf8');
            const scriptResult = await this.runAppleScriptJson('trigger-macro.applescript', ['ExportSlideNotes', filePath]);
            if (!scriptResult.success) {
                return { success: false, message: scriptResult.message || 'Failed to export slide notes.' };
            }

            const notes = this.parseNotesExportFile(outputPath);
            return { success: true, notes: notes[slideIndex] || '' };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        } finally {
            cleanupPaths(paramsPath, outputPath);
        }
    }

    /**
     * Extracts images and notes from a PowerPoint presentation into an output directory.
     *
     * @param filePath - The path to the PowerPoint file to convert.
     * @param outputDir - The directory where the extracted assets should be saved.
     * @returns A promise resolving to the conversion success status and extracted slide data.
     */
    async convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult> {
        const imageResult = await this.exportSlideImages(filePath, outputDir);
        if (!imageResult.success) {
            return imageResult;
        }

        const notesResult = await this.readAllSlideNotes(filePath);
        if (!notesResult.success) {
            return notesResult;
        }

        if (!imageResult.images || !notesResult.notes) {
            return { success: false, message: 'Image or notes export returned no data.' };
        }

        try {
            const slides = this.mergeSlideData(imageResult.images, notesResult.notes);

            this.focusApp();
            return { success: true, slides: buildSlidesWithPaths(slides, outputDir) };
        } catch (err: unknown) {
            return { success: false, message: getErrorMessage(err) };
        }
    }

    /**
     * Inserts audio into the specified slides using a VBA macro triggered via AppleScript.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slidesAudio - An array containing objects with audio data and target slide indices.
     * @returns A promise resolving to the success status of the operation.
     */
    async insertAudio(filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
        if (!slidesAudio || slidesAudio.length === 0) return { success: true };

        const officeContainer = this.getOfficeContainerPath();
        const audioSessionDir = path.join(officeContainer, 'TemporaryAudio', `session-${Date.now()}`);

        try {
            fs.mkdirSync(audioSessionDir, { recursive: true });
        } catch (e) {
            return { success: false, message: 'Could not create audio directory in Office container.' };
        }

        try {
            let batchParams = '';
            for (const slide of slidesAudio) {
                const buffer = Buffer.from(slide.audioData);
                const slideDir = path.join(audioSessionDir, `slide_${slide.index}`);
                fs.mkdirSync(slideDir, { recursive: true });
                const audioFileName = buildPptAudioFileName(slide.sectionIndex);
                const audioFilePath = path.join(slideDir, audioFileName);

                fs.writeFileSync(audioFilePath, buffer);
                batchParams += `${filePath}|${slide.index}|${audioFilePath}\n`;
            }

            const paramsPath = path.join(officeContainer, 'insert_audio_params.txt');
            fs.writeFileSync(paramsPath, batchParams, 'utf8');

            const scriptResult = await this.runAppleScriptJson('trigger-macro.applescript', ['InsertAudio', filePath]);
            if (!scriptResult.success) {
                return { success: false, message: scriptResult.message || 'Failed to insert audio.' };
            }

            this.focusApp();

            return { success: true };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        } finally {
            cleanupPaths(path.join(officeContainer, 'insert_audio_params.txt'), audioSessionDir);
        }
    }

    /**
     * Removes audio from the specified slides.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slideIndices - The 1-based indices of the slides to update.
     * @returns A promise resolving to the success status of the operation.
     */
    async removeAudio(filePath: string, slideIndices: number[]): Promise<BasicPptResult> {
        const officeContainer = this.getOfficeContainerPath();
        const paramsPath = path.join(officeContainer, 'remove_audio_params.txt');

        try {
            const paramsContent = `${filePath}|${slideIndices.join(',')}`;
            fs.writeFileSync(paramsPath, paramsContent, 'utf8');

            const scriptResult = await this.runAppleScriptJson('trigger-macro.applescript', ['RemoveAudio', filePath]);
            if (!scriptResult.success) {
                return { success: false, message: scriptResult.message || 'Failed to remove audio.' };
            }

            this.focusApp();
            return { success: true };
        } finally {
            cleanupPaths(paramsPath);
        }
    }

    /**
     * Updates speaker notes for the specified slides using a VBA macro.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slides - An array of slide objects containing updated notes.
     * @returns A promise resolving to the success status of the operation.
     */
    async saveNotes(filePath: string, slides: SlideManifestEntry[]): Promise<BasicPptResult> {
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
            const scriptResult = await this.runAppleScriptJson('trigger-macro.applescript', ['UpdateNotes', filePath]);
            if (!scriptResult.success) {
                return { success: false, message: scriptResult.message || 'Failed to update notes.' };
            }

            this.focusApp();
            return { success: true };
        } finally {
            cleanupPaths(dataPath, paramsPath);
        }
    }

    /**
     * Exports the PowerPoint presentation to a video file.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param videoOutputPath - The target path for the generated video file.
     * @returns A promise resolving to the success status and the output path.
     */
    async generateVideo(filePath: string, videoOutputPath: string): Promise<VideoPptResult> {
        try {
            const exportScriptPath = resolveScriptPath('export-to-video.applescript');
            const child = spawn('osascript', [exportScriptPath, videoOutputPath, filePath]);

            await new Promise<void>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: Buffer) => stdout += d.toString());
                child.stderr.on('data', (d: Buffer) => stderr += d.toString());
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
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        }
    }

    /**
     * Enters presentation mode and navigates to the specified slide.
     *
     * @param slideIndex - The index of the slide to start playing from.
     * @returns A promise resolving to the success status.
     */
    async playSlide(filePath: string, slideIndex: number): Promise<BasicPptResult> {
        const scriptResult = await this.runAppleScriptJson('play-slide.applescript', [slideIndex.toString(), filePath]);
        if (!scriptResult.success) {
            return { success: false, message: scriptResult.message || 'Failed to play slide.' };
        }

        return { success: true };
    }

    /**
     * Reloads an individual slide by re-exporting its image and fetching its notes.
     *
     * @param filePath - The path to the PowerPoint file.
     * @param slideIndex - The index of the slide to reload.
     * @param outputDir - The directory where the reloaded slide assets should be updated.
     * @returns A promise resolving to the fresh set of slides or an error message.
     */
    async reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<SlidePptResult> {
        const imageResult = await this.reloadSlideImage(filePath, slideIndex, outputDir);
        if (!imageResult.success) {
            return imageResult;
        }

        const notesResult = await this.readSlideNotes(filePath, slideIndex);
        if (!notesResult.success) {
            return notesResult;
        }

        if (!imageResult.image || notesResult.notes === undefined) {
            return { success: false, message: 'Slide image or notes export returned no data.' };
        }

        try {
            const [slide] = buildSlidesWithPaths(
                [{ index: slideIndex, image: imageResult.image, notes: notesResult.notes }],
                outputDir,
            );

            this.focusApp();
            return { success: true, slide };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        }
    }
}

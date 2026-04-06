import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { PptProvider } from './PptProvider';
import { resolveScriptPath } from './helpers';

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

    /**
     * Clears all temporary audio session data from the Office Container.
     */
    private cleanup(): void {
        try {
            const homeDir = app.getPath('home');
            const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');
            const tempAudioDir = path.join(officeContainer, 'TemporaryAudio');
            if (fs.existsSync(tempAudioDir)) {
                fs.rmSync(tempAudioDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.error("Cleanup failed:", e);
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
            console.error("Failed to close presentation", e);
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
            console.error("Failed to reopen presentation", e);
        }
        
        // Focus App Back
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].show();
            windows[0].focus();
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
        const tempDir = app.getPath('temp');
        if (!fs.existsSync(path.join(tempDir, 'ppt-viewer'))) {
            fs.mkdirSync(path.join(tempDir, 'ppt-viewer'), { recursive: true });
        }

        try {
            const scriptPath = resolveScriptPath('convert-pptx.applescript');
            const child = spawn('osascript', [scriptPath, filePath, outputDir]);

            return new Promise((resolve, reject) => {
                let stdout = '';
                let stderr = '';

                child.stdout.on('data', (data: any) => { stdout += data; });
                child.stderr.on('data', (data: any) => { stderr += data; });

                child.on('close', (code: number) => {
                    if (code === 0) {
                        try {
                            const manifestPath = path.join(outputDir, 'manifest.json');
                            const data = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
                            const slides = JSON.parse(data);
                            const slidesWithPaths = slides.map((s: any) => ({
                                ...s,
                                src: s.image ? `file://${path.join(outputDir, s.image)}?t=${Date.now()}` : null,
                                notes: s.notes ? s.notes.replace(/\\n/g, '\n') : ''
                            })).filter((s: any) => s.src !== null);
                            resolve({ success: true, slides: slidesWithPaths });
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        reject(new Error(`Conversion failed with code ${code}: ${stderr || stdout}`));
                    }
                });
            });
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

        const homeDir = app.getPath('home');
        const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');
        const audioSessionDir = path.join(officeContainer, 'TemporaryAudio', `session-${Date.now()}`);

        try {
            fs.mkdirSync(audioSessionDir, { recursive: true });
        } catch (e) {
            return { success: false, error: "Could not create audio directory in Office container." };
        }

        try {
            let batchParams = "";
            for (const slide of slidesAudio) {
                const buffer = Buffer.from(slide.audioData);
                const slideDir = path.join(audioSessionDir, `slide_${slide.index}`);
                if (!fs.existsSync(slideDir)) {
                    fs.mkdirSync(slideDir, { recursive: true });
                }
                const audioFileName = slide.sectionIndex !== undefined ? `ppt_audio_${slide.sectionIndex + 1}.mp3` : `ppt_audio_1.mp3`;
                const audioFilePath = path.join(slideDir, audioFileName);

                fs.writeFileSync(audioFilePath, buffer);
                batchParams += `${slide.index}|${audioFilePath}|${filePath}\n`;
            }

            const scriptPath = resolveScriptPath('trigger-macro.applescript');
            const paramsPath = path.join(officeContainer, 'audio_params.txt');
            fs.writeFileSync(paramsPath, batchParams, 'utf8');

            const child = spawn('osascript', [scriptPath, "InsertAudio", filePath]);

            await new Promise<void>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: any) => stdout += d);
                child.stderr.on('data', (d: any) => stderr += d);
                child.on('close', (code: number) => {
                    // Always clean up parameters file
                    try { fs.unlinkSync(paramsPath); } catch (e) { }

                    // Always clean up the specific session directory
                    try { fs.rmSync(audioSessionDir, { recursive: true, force: true }); } catch (e) { }

                    if (code === 0 && !stdout.includes("Error")) {
                        resolve();
                    } else {
                        reject(new Error(stdout || stderr));
                    }
                });
            });
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
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
        return new Promise((resolve) => {
            const homeDir = app.getPath('home');
            const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');

            const paramsPath = path.join(officeContainer, 'remove_audio_params.txt');
            const paramsContent = `${filePath}|${scope}|${slideIndex || 0}`;
            fs.writeFileSync(paramsPath, paramsContent, 'utf8');

            const scriptPath = resolveScriptPath('trigger-macro.applescript');
            const child = spawn('osascript', [scriptPath, "RemoveAudio", filePath]);

            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d: any) => stdout += d.toString());
            child.stderr.on('data', (d: any) => stderr += d.toString());
            child.on('close', (code: number) => {
                if (code === 0 && !stdout.includes("Error")) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: stdout || stderr });
                }
            });
        });
    }

    /**
     * Updates speaker notes for the specified slides using a VBA macro.
     * 
     * @param filePath - The path to the PowerPoint file.
     * @param slides - An array of slide objects containing updated notes.
     * @param slidesAudio - Optional audio data associated with the slides.
     * @returns A promise resolving to the success status of the operation.
     */
    async saveAllNotes(filePath: string, slides: any[], slidesAudio: any[]): Promise<any> {
        const homeDir = app.getPath('home');
        const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');

        let dataContent = "";
        for (const s of slides) {
            if (s.notes) {
                dataContent += `###SLIDE_START### ${s.index}\n${s.notes}\n###SLIDE_END###\n`;
            }
        }

        const dataPath = path.join(officeContainer, `notes_data_${Date.now()}.txt`);
        fs.writeFileSync(dataPath, dataContent, 'utf8');

        const paramsPath = path.join(officeContainer, 'notes_params.txt');
        const paramsContent = `${filePath}|${dataPath}`;
        fs.writeFileSync(paramsPath, paramsContent, 'utf8');

        const scriptPath = resolveScriptPath('trigger-macro.applescript');
        const child = spawn('osascript', [scriptPath, "UpdateNotes", filePath]);

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d: any) => stdout += d);
            child.stderr.on('data', (d: any) => stderr += d);
            child.on('close', (code: number) => {
                try { fs.unlinkSync(dataPath); } catch (e) { }

                if (code === 0 && !stdout.includes("Error")) {
                    resolve({ success: true });
                } else {
                    reject(new Error(stdout || stderr));
                }
            });
        });
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
                    if (code === 0 && !stdout.includes("Error")) {
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
    async playSlide(slideIndex: number): Promise<any> {
        const scriptPath = resolveScriptPath('play-slide.applescript');
        return new Promise((resolve) => {
            const child = spawn('osascript', [scriptPath, slideIndex.toString()]);
            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => output += data.toString());
            child.stderr.on('data', (data) => errorOutput += data.toString());

            child.on('close', (code) => {
                if (code === 0) {
                    if (output.includes("Error")) resolve({ success: false, error: output.trim() });
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
        const scriptPath = resolveScriptPath('reload-slide.applescript');
        const child = spawn('osascript', [scriptPath, filePath, slideIndex.toString(), outputDir]);

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data: any) => stdout += data.toString());
            child.stderr.on('data', (data: any) => stderr += data.toString());

            child.on('close', (code: number) => {
                if (code === 0 && !stdout.includes("Error")) {
                    try {
                        const parts = stdout.trim().split('|||');
                        if (parts.length < 2) throw new Error("Invalid script output: " + stdout);

                        const imageRelPath = parts[0];
                        const newNotes = parts[1] || '';

                        const manifestPath = path.join(outputDir, 'manifest.json');
                        const manifestData = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
                        const slides = JSON.parse(manifestData);

                        const slide = slides.find((s: any) => s.index === slideIndex);
                        if (slide) {
                            slide.image = imageRelPath;
                            slide.notes = newNotes;
                        } else {
                            slides.push({ index: slideIndex, image: imageRelPath, notes: newNotes });
                            slides.sort((a: any, b: any) => a.index - b.index);
                        }

                        fs.writeFileSync(manifestPath, JSON.stringify(slides, null, 2), 'utf8');

                        const slidesWithPaths = slides.map((s: any) => ({
                            ...s,
                            src: s.image ? `file://${path.join(outputDir, s.image)}?t=${Date.now()}` : null,
                            notes: s.notes ? s.notes.replace(/\\n/g, '\n') : ''
                        })).filter((s: any) => s.src !== null);

                        const windows = BrowserWindow.getAllWindows();
                        if (windows.length > 0) {
                            windows[0].show();
                            windows[0].focus();
                        }

                        resolve({ success: true, slides: slidesWithPaths });
                    } catch (e: any) {
                        resolve({ success: false, error: e.message });
                    }
                } else {
                    resolve({ success: false, error: stderr || stdout || 'Unknown error syncing slide' });
                }
            });
        });
    }
}

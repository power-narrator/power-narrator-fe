import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { PptProvider } from './PptProvider';
import { resolveScriptPath } from './helpers';

export class XmlPptProvider implements PptProvider {
    constructor(private baseProvider: PptProvider) {}

    private async runXmlCli(inputPath: string, outputPath: string | null, ops: any[], options: { skipClose?: boolean, skipReopen?: boolean } = {}): Promise<any> {
        const tempDir = app.getPath('temp');
        const reqPath = path.join(tempDir, 'request.json');
        const resPath = path.join(tempDir, 'response.json');

        const payload = { input: inputPath, output: outputPath, ops: ops };
        fs.writeFileSync(reqPath, JSON.stringify(payload, null, 2), 'utf8');

        let currentSlideIndex = 1;
        if (!options.skipClose && this.baseProvider.closePresentation) {
            currentSlideIndex = await this.baseProvider.closePresentation(inputPath);
        }

        const cliResult: any = await new Promise((resolve) => {
            const env = Object.assign({}, process.env);
            const localBinDir = path.join(app.getPath('home'), '.local', 'bin');
            if (env.PATH && !env.PATH.includes(localBinDir)) {
                env.PATH = `${localBinDir}:${env.PATH}`;
            }

            let child;
            if (app.isPackaged) {
                const cliPath = resolveScriptPath(path.join('xml-cli', 'slide-voice-pptx'));
                child = spawn(cliPath, [reqPath, resPath], { env: env });
            } else {
                const cliDir = path.join(__dirname, '../../xml/slide-voice-app');
                child = spawn('uv', ['run', '-m', 'slide_voice_pptx', reqPath, resPath], {
                    cwd: cliDir,
                    env: env
                });
            }

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (d: any) => stdout += d.toString());
            child.stderr.on('data', (d: any) => stderr += d.toString());

            child.on('close', (code: number) => {
                if (fs.existsSync(resPath)) {
                    try {
                        const resultData = JSON.parse(fs.readFileSync(resPath, 'utf8'));
                        if (code === 0) resolve({ success: true, data: resultData });
                        else resolve({ success: false, error: `CLI failed with code ${code}. Stderr: ${stderr}. Result: ${JSON.stringify(resultData)}` });
                    } catch (e: any) {
                        resolve({ success: false, error: `Failed to parse response JSON: ${e.message}. Stderr: ${stderr}` });
                    }
                } else {
                    resolve({ success: false, error: `CLI did not produce response.json. Code: ${code}. Stderr: ${stderr}. Stdout: ${stdout}` });
                }
            });
            
            child.on('error', (err: any) => {
                resolve({ success: false, error: `Failed to start process: ${err.message}` });
            });
        });

        if (!options.skipReopen && this.baseProvider.reopenPresentation) {
            await this.baseProvider.reopenPresentation(inputPath, currentSlideIndex);
        }

        return cliResult;
    }

    async insertAudio(filePath: string, slidesAudio: any[]): Promise<any> {
        if (!slidesAudio || slidesAudio.length === 0) return { success: true };

        const tempDir = app.getPath('temp');
        const sessionDir = path.join(tempDir, `ppt_audio_${Date.now()}`);
        fs.mkdirSync(sessionDir, { recursive: true });

        const slidesToClear = new Set<number>();
        for (const slide of slidesAudio) slidesToClear.add(slide.index);

        const ops = [];
        for (const slideIndex of slidesToClear) {
            ops.push({ op: 'clear_audio_for_slide', args: { slide_index: slideIndex - 1 } });
        }

        for (const slide of slidesAudio) {
            const buffer = Buffer.from(slide.audioData);
            const slideDir = path.join(sessionDir, `slide_${slide.index}`);
            if (!fs.existsSync(slideDir)) fs.mkdirSync(slideDir, { recursive: true });
            const audioFileName = slide.sectionIndex !== undefined ? `ppt_audio_${slide.sectionIndex + 1}.mp3` : `ppt_audio_1.mp3`;
            const audioFilePath = path.join(slideDir, audioFileName);
            fs.writeFileSync(audioFilePath, buffer);

            ops.push({
                op: 'save_audio_for_slide',
                args: { slide_index: slide.index - 1, mp3_path: audioFilePath }
            });
        }

        const result = await this.runXmlCli(filePath, filePath, ops);
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}

        return result;
    }

    async removeAudio(filePath: string, scope: string, slideIndex: number): Promise<any> {
        let slideIndexBefore = 1;
        if (this.baseProvider.closePresentation) {
            slideIndexBefore = await this.baseProvider.closePresentation(filePath);
        }

        const queryResult = await this.runXmlCli(filePath, null, [{ op: 'get_slides', args: {} }], { skipClose: true, skipReopen: true });
        
        if (!queryResult.success) {
            if (this.baseProvider.reopenPresentation) await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
            return { success: false, error: "Failed to query slide content: " + queryResult.error };
        }

        const slideData = queryResult.data?.results?.[0]?.result;
        if (!slideData) {
            if (this.baseProvider.reopenPresentation) await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
            return { success: false, error: "Could not find slide data" };
        }

        const deleteOps: any[] = [];
        let targetIndex = slideIndex - 1;

        if (scope === 'all') {
            slideData.forEach((slide: any, idx: number) => {
                const slideAudio = slide.audio || [];
                slideAudio.forEach((audio: any) => {
                    deleteOps.push({ op: 'delete_audio_for_slide', args: { slide_index: idx, name: audio.name } });
                });
            });
        } else {
            if (!slideData[targetIndex]) {
                if (this.baseProvider.reopenPresentation) await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
                return { success: false, error: "Could not find slide data for index " + targetIndex };
            }

            const slideAudio = slideData[targetIndex].audio || [];
            let targetAudio = slideAudio.find((a: any) => a.name.toLowerCase().includes('audio'));
            if (!targetAudio && slideAudio.length > 0) targetAudio = slideAudio[0];

            if (targetAudio) {
                deleteOps.push({ op: 'delete_audio_for_slide', args: { slide_index: targetIndex, name: targetAudio.name } });
            }
        }

        if (deleteOps.length === 0) {
            if (this.baseProvider.reopenPresentation) await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
            return { success: true };
        }

        const result = await this.runXmlCli(filePath, filePath, deleteOps, { skipClose: true, skipReopen: true });
        if (this.baseProvider.reopenPresentation) await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);

        return result;
    }

    async saveAllNotes(filePath: string, slides: any[], slidesAudio: any[]): Promise<any> {
        const ops = slides.filter((s:any) => s.notes).map((s:any) => ({
            op: 'set_slide_notes',
            args: { slide_index: s.index - 1, notes: s.notes }
        }));
        
        if (ops.length === 0) return { success: true };

        return await this.runXmlCli(filePath, filePath, ops);
    }

    async convertPptx(filePath: string, outputDir: string): Promise<any> {
        return this.baseProvider.convertPptx(filePath, outputDir);
    }
    
    async generateVideo(filePath: string, videoOutputPath: string): Promise<any> {
        return this.baseProvider.generateVideo(filePath, videoOutputPath);
    }

    async playSlide(slideIndex: number): Promise<any> {
        return this.baseProvider.playSlide(slideIndex);
    }

    async syncSlide(filePath: string, slideIndex: number, outputDir: string): Promise<any> {
        return this.baseProvider.syncSlide(filePath, slideIndex, outputDir);
    }
}

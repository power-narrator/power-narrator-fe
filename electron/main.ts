import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import dotenv from 'dotenv';

// Load .env
dotenv.config();

import Store from 'electron-store';
const store = new Store();

// --- Helper to get GCP Key Path ---
function getGcpKeyPath(): string | undefined {
    // Priority: 1. ENV var (dev/runtime override), 2. Stored path
    return process.env.GOOGLE_APPLICATION_CREDENTIALS || store.get('gcpKeyPath') as string;
}

function getTtsProvider(): string {
    // Priority: 1. ENV var, 2. Stored Key -> implies GCP, 3. Default to GCP (so we prompt for key)
    if (process.env.TTS_PROVIDER) return process.env.TTS_PROVIDER;
    if (getGcpKeyPath()) return 'gcp';
    return 'gcp'; // Default to GCP instead of local, so we hit the "missing key" check
}

function resolveScriptPath(scriptName: string): string {
    if (app.isPackaged) {
        // In production, scripts are unpacked to Resources/electron/scripts
        return path.join(process.resourcesPath, 'electron', 'scripts', scriptName);
    } else {
        // In dev, scripts are in electron/scripts relative to main.ts
        return path.join(__dirname, '../electron/scripts', scriptName);
    }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

const createWindow = () => {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false // Optional, but helps avoid some local file loading issues
        },
    });

    if (!app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist-vite/index.html'));
        // Optional: Open DevTools on specific key combination for debugging production builds
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.control && input.shift && input.key.toLowerCase() === 'i') {
                mainWindow.webContents.toggleDevTools();
                event.preventDefault();
            }
        });
    }
};

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
ipcMain.handle('select-file', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});

// --- XML CLI Helper ---
// --- PPT Lifecycle Helpers ---
async function closePresentation(filePath: string): Promise<number> {
    if (process.platform !== 'darwin') return 1;
    const path = require('path');
    const { spawn } = require('child_process');
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
        console.log("Closed presentation, was on slide " + slideIndex);
        return slideIndex;
    } catch (e) {
        console.error("Failed to close presentation", e);
        return 1;
    }
}

async function reopenPresentation(filePath: string, slideIndex: number) {
    if (process.platform !== 'darwin') return;
    const { spawn } = require('child_process');
    try {
        const reopenScript = resolveScriptPath('reopen-presentation.applescript');
        const childReopen = spawn('osascript', [reopenScript, filePath, slideIndex.toString()]);
        await new Promise<void>((resolve) => {
            childReopen.on('close', () => resolve());
        });
        console.log("Reopened presentation at slide " + slideIndex);
    } catch (e) {
        console.error("Failed to reopen presentation", e);
    }
    
    // Focus App Back
    const BrowserWindow = require('electron').BrowserWindow;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].show();
        windows[0].focus();
    }
}

// --- XML CLI Helper ---
async function runXmlCli(inputPath: string, outputPath: string | null, ops: any[], options: { skipClose?: boolean, skipReopen?: boolean } = {}): Promise<any> {
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');

    const tempDir = app.getPath('temp');
    const reqPath = path.join(tempDir, 'request.json');
    const resPath = path.join(tempDir, 'response.json');

    const payload = {
        input: inputPath,
        output: outputPath,
        ops: ops
    };

    fs.writeFileSync(reqPath, JSON.stringify(payload, null, 2), 'utf8');

    // 1. Close presentation if MacOS
    let currentSlideIndex = 1;
    if (!options.skipClose && process.platform === 'darwin') {
        currentSlideIndex = await closePresentation(inputPath);
    }

    // 2. Run Python CLI
    const cliResult: any = await new Promise((resolve) => {
        const env = Object.assign({}, process.env);
        const localBinDir = path.join(app.getPath('home'), '.local', 'bin');
        if (env.PATH && !env.PATH.includes(localBinDir)) {
            env.PATH = `${localBinDir}:${env.PATH}`;
        }

        let child;
        if (app.isPackaged) {
            const cliPath = resolveScriptPath(path.join('xml-cli', 'slide-voice-pptx'));
            child = spawn(cliPath, [reqPath, resPath], { 
                env: env 
            });
        } else {
            // Expected location of the slide-voice-app component in dev
            const cliDir = path.join(__dirname, '../xml/slide-voice-app');
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
                    if (code === 0) {
                        resolve({ success: true, data: resultData });
                    } else {
                        resolve({ success: false, error: `CLI failed with code ${code}. Stderr: ${stderr}. Result: ${JSON.stringify(resultData)}` });
                    }
                } catch (e: any) {
                    resolve({ success: false, error: `Failed to parse response JSON: ${e.message}. Stderr: ${stderr}` });
                }
            } else {
                resolve({ success: false, error: `CLI did not produce response.json. Code: ${code}. Stderr: ${stderr}. Stdout: ${stdout}` });
            }
        });
        
        child.on('error', (err: any) => {
            resolve({ success: false, error: `Failed to start uv process: ${err.message}` });
        });
    });

    // 3. Reopen presentation if MacOS
    if (!options.skipReopen && process.platform === 'darwin') {
        await reopenPresentation(inputPath, currentSlideIndex);
    }

    return cliResult;
}

ipcMain.handle('convert-pptx', async (event, filePath) => {
    console.log('Convert request for (raw):', filePath);

    // Resolve to absolute path to handle relative paths (e.g. from dev environment)
    const absolutePath = path.resolve(filePath);
    console.log('Convert request for (absolute):', absolutePath);

    const fs = require('fs');
    if (!fs.existsSync(absolutePath)) {
        return { success: false, error: `File not found: ${absolutePath}` };
    }

    const os = process.platform;
    const tempDir = app.getPath('temp');
    const outputDir = path.join(tempDir, 'ppt-viewer', path.basename(absolutePath, path.extname(absolutePath)));

    // Ensure parent dir exists
    if (!fs.existsSync(path.join(tempDir, 'ppt-viewer'))) {
        fs.mkdirSync(path.join(tempDir, 'ppt-viewer'));
    }

    console.log('Output Dir:', outputDir);

    try {
        if (os === 'win32') {
            const scriptPath = resolveScriptPath('convert-win.ps1');
            console.log('Script Path:', scriptPath);

            // Spawn PowerShell
            const { spawn } = require('child_process');
            // We use 'powershell.exe' directly
            const child = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath,
                '-InputPath', absolutePath,
                '-OutputDir', outputDir
            ]);

            return new Promise((resolve, reject) => {
                let stdout = '';
                let stderr = '';

                child.stdout.on('data', (data: any) => {
                    console.log(`stdout: ${data}`);
                    stdout += data;
                });

                child.stderr.on('data', (data: any) => {
                    console.error(`stderr: ${data}`);
                    stderr += data;
                });

                child.on('close', async (code: number) => {
                    if (code === 0) {
                        // Read manifest
                        const manifestPath = path.join(outputDir, 'manifest.json');
                        try {
                            const fs = require('fs'); // Use sync fs for simplicity inside async callback, or keep promises
                            // Using readFileSync to be safe with blocking logic if preferred, or promises
                            const data = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
                            const slides = JSON.parse(data);
                            // Fix image paths to be absolute or protocol based
                            const slidesWithPaths = slides.map((s: any) => ({
                                ...s,
                                ...s,
                                src: `file://${path.join(outputDir, s.image)}?t=${Date.now()}`,
                                notes: s.notes ? s.notes.replace(/\\n/g, '\n') : ''
                            }));

                            // Focus App Back
                            const window = BrowserWindow.fromWebContents(event.sender);
                            if (window) {
                                window.show();
                                window.focus();
                            }

                            resolve({ success: true, slides: slidesWithPaths });
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        reject(new Error(`Conversion failed with code ${code}: ${stderr}`));
                    }
                });
            });
        }

        else if (os === 'darwin') {
            const scriptPath = resolveScriptPath('convert-mac.applescript');
            console.log('Script Path (Mac):', scriptPath);

            const { spawn } = require('child_process');
            const child = spawn('osascript', [
                scriptPath,
                absolutePath,
                outputDir
            ]);

            return new Promise((resolve, reject) => {
                let stdout = '';
                let stderr = '';

                child.stdout.on('data', (data: any) => { console.log('OSAScript:', data.toString()); stdout += data; });
                child.stderr.on('data', (data: any) => { console.error('OSAScript Err:', data.toString()); stderr += data; });

                child.on('close', (code: number) => {
                    if (code === 0) {
                        try {
                            const fs = require('fs');
                            console.log('--- Output Directory Contents ---');
                            // Simple recursive list for debugging
                            const listDir = (dir: string) => {
                                const files = fs.readdirSync(dir);
                                files.forEach((file: string) => {
                                    const p = path.join(dir, file);
                                    if (fs.statSync(p).isDirectory()) {
                                        console.log(`[DIR] ${p}`);
                                        listDir(p);
                                    } else {
                                        console.log(`[FILE] ${p}`);
                                    }
                                });
                            };
                            listDir(outputDir);
                            console.log('-------------------------------');
                        } catch (e) {
                            console.error('Error listing dir:', e);
                        }

                        // Read manifest
                        const manifestPath = path.join(outputDir, 'manifest.json');
                        try {
                            const fs = require('fs');
                            const data = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
                            console.log('Manifest Content Sample (First 100 chars):', data.substring(0, 100));
                            // Debug encoding
                            const rawBuffer = fs.readFileSync(manifestPath);
                            console.log('Manifest Start Hex:', rawBuffer.subarray(0, 20).toString('hex'));
                            const slides = JSON.parse(data);
                            const slidesWithPaths = slides.map((s: any) => ({
                                ...s,
                                src: s.image ? `file://${path.join(outputDir, s.image)}?t=${Date.now()}` : null,
                                // Fix escaped newlines from AppleScript/Perl pipeline
                                notes: s.notes ? s.notes.replace(/\\n/g, '\n') : ''
                            })).filter((s: any) => s.src !== null); // Filter out bad slides
                            resolve({ success: true, slides: slidesWithPaths });
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        reject(new Error(`Conversion failed with code ${code}: ${stderr || stdout}`));
                    }
                });
            });
        }

        // TODO: Implement other platforms
        return { success: false, error: 'Platform not supported yet' };


    } catch (err: any) {
        console.error('Conversion error:', err);
        return { success: false, error: err.message };
    }
});

// --- Helper for Audio Insertion ---
async function handleAudioInsertion(filePath: string, slidesAudio: any[]) {
    console.log(`handleAudioInsertion for ${slidesAudio.length} slides`);
    const path = require('path');
    const fs = require('fs');
    const { spawn } = require('child_process');
    const app = require('electron').app;

    if (!slidesAudio || slidesAudio.length === 0) return { success: true };

    // Define the Office Group Container path for sandboxed access
    const homeDir = app.getPath('home');
    const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');
    const audioSessionDir = path.join(officeContainer, 'TemporaryAudio', `session-${Date.now()}`);

    // Ensure directory exists
    try {
        fs.mkdirSync(audioSessionDir, { recursive: true });
    } catch (e) {
        console.error("Failed to create Office container dir:", e);
        return { success: false, error: "Could not create audio directory in Office container. Check permissions." };
    }

    try {
        let batchParams = "";

        // 1. Save all audio files and prepare batch params
        for (const slide of slidesAudio) {
            console.log(`Processing slide ${slide.index}`);
            // audioData might be coming as an object from IPC, need to ensure it's a buffer
            const buffer = Buffer.from(slide.audioData);
            const slideDir = path.join(audioSessionDir, `slide_${slide.index}`);
            if (!fs.existsSync(slideDir)) {
                fs.mkdirSync(slideDir, { recursive: true });
            }
            const audioFileName = slide.sectionIndex !== undefined ? `ppt_audio_${slide.sectionIndex + 1}.mp3` : `ppt_audio_1.mp3`;
            const audioFilePath = path.join(slideDir, audioFileName);

            fs.writeFileSync(audioFilePath, buffer);
            console.log(`Saved audio to ${audioFilePath}`);

            // Append to batch params: Index|AudioPath|PresentationPath
            batchParams += `${slide.index}|${audioFilePath}|${filePath}\n`;
        }

        if (process.platform === 'darwin') {
            const scriptPath = resolveScriptPath('trigger-macro.applescript');

            // 2. Write ALL parameters to file ONCE
            // audio_params.txt content: "SlideIndex|AudioPath|PresentationPath" (Multiple lines)
            const paramsPath = path.join(officeContainer, 'audio_params.txt');
            fs.writeFileSync(paramsPath, batchParams, 'utf8');

            // 3. Call the GENERIC macro runner ONCE
            // Args: macroName, pptPath
            console.log("Triggering batch audio insertion macro...");
            const child = spawn('osascript', [
                scriptPath,
                "InsertAudio",
                filePath
            ]);

            await new Promise<void>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: any) => stdout += d);
                child.stderr.on('data', (d: any) => stderr += d);
                child.on('close', (code: number) => {
                    if (code === 0 && !stdout.includes("Error")) {
                        console.log(`Batch audio macro completed successfully.`);
                        resolve();
                    } else {
                        console.error(`Failed to run batch audio macro: ${stderr} ${stdout}`);
                        reject(new Error(stdout || stderr));
                    }
                });
            });
            return { success: true };
        } else {
            return { success: false, error: "Windows audio insertion not implemented" };
        }
    } catch (e: any) {
        console.error('Audio insertion failed:', e);
        return { success: false, error: e.message };
    }
}

ipcMain.handle('save-all-notes', async (event, filePath, slides, slidesAudio) => {
    console.log('Save All Notes request for:', filePath);

    // Resolve absolute path
    const absolutePath = path.resolve(filePath);
    const fs = require('fs');

    if (!fs.existsSync(absolutePath)) {
        return { success: false, error: 'File not found' };
    }

    try {
        const useXmlCli = store.get('xmlCliEnabled') || false;

        if (useXmlCli) {
            console.log('Using XML CLI for saving notes');
            const ops = slides.filter((s:any) => s.notes).map((s:any) => ({
                op: 'set_slide_notes',
                args: {
                    slide_index: s.index - 1, // API is 0-indexed, PPT index is usually 1-indexed
                    notes: s.notes
                }
            }));
            
            if (ops.length === 0) {
                 return { success: true };
            }

            const result = await runXmlCli(absolutePath, absolutePath, ops);
            if (!result.success) {
                return { success: false, error: result.error };
            }
            return { success: true };
        }

        if (process.platform === 'darwin') {
            const app = require('electron').app;
            const homeDir = app.getPath('home');
            const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');

            // 1. Prepare Data File
            // Format:
            // ###SLIDE_START### 1
            // Notes...
            // ###SLIDE_END###

            let dataContent = "";
            for (const s of slides) {
                if (s.notes) {
                    dataContent += `###SLIDE_START### ${s.index}\n${s.notes}\n###SLIDE_END###\n`;
                }
            }

            const dataPath = path.join(officeContainer, `notes_data_${Date.now()}.txt`);
            fs.writeFileSync(dataPath, dataContent, 'utf8');

            // 2. Prepare Params File
            const paramsPath = path.join(officeContainer, 'notes_params.txt');
            // Content: PresentationPath|DataPath
            const paramsContent = `${absolutePath}|${dataPath}`;
            fs.writeFileSync(paramsPath, paramsContent, 'utf8');

            // 3. Trigger Macro
            const scriptPath = resolveScriptPath('trigger-macro.applescript');

            // Args: macroName, pptPath
            const { spawn } = require('child_process');
            const child = spawn('osascript', [
                scriptPath,
                "UpdateNotes",
                absolutePath
            ]);

            await new Promise<void>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: any) => stdout += d);
                child.stderr.on('data', (d: any) => stderr += d);
                child.on('close', (code: number) => {
                    // Cleanup data file
                    try { fs.unlinkSync(dataPath); } catch (e) { }

                    if (code === 0 && !stdout.includes("Error")) {
                        console.log(`UpdateNotes macro triggered.`);
                        resolve();
                    } else {
                        console.error(`Failed to trigger UpdateNotes: ${stderr} ${stdout}`);
                        reject(new Error(stdout || stderr));
                    }
                });
            });

            return { success: true };

        } else {
            // Windows implementation...
            return { success: false, error: 'Save not supported on this platform yet' };
        }

    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('insert-audio', async (event, filePath, slidesAudio) => {
    console.log('Insert Audio request for:', filePath);

    const absolutePath = path.resolve(filePath);
    const fs = require('fs');

    if (!fs.existsSync(absolutePath)) {
        return { success: false, error: 'File not found' };
    }

    try {
        if (slidesAudio && slidesAudio.length > 0) {
            console.log('Inserting audio...');
            const useXmlCli = store.get('xmlCliEnabled') || false;

            if (useXmlCli) {
                console.log('Using XML CLI for inserting audio');
                const app = require('electron').app;
                const tempDir = app.getPath('temp');
                const sessionDir = path.join(tempDir, `ppt_audio_${Date.now()}`);
                fs.mkdirSync(sessionDir, { recursive: true });

                const slidesToClear = new Set<number>();
                for (const slide of slidesAudio) {
                    slidesToClear.add(slide.index);
                }

                const ops = [];
                for (const slideIndex of slidesToClear) {
                    ops.push({
                        op: 'clear_audio_for_slide',
                        args: {
                            slide_index: slideIndex - 1 // 0-indexed API
                        }
                    });
                }

                for (const slide of slidesAudio) {
                    const buffer = Buffer.from(slide.audioData);
                    const slideDir = path.join(sessionDir, `slide_${slide.index}`);
                    if (!fs.existsSync(slideDir)) {
                        fs.mkdirSync(slideDir, { recursive: true });
                    }
                    const audioFileName = slide.sectionIndex !== undefined ? `ppt_audio_${slide.sectionIndex + 1}.mp3` : `ppt_audio_1.mp3`;
                    const audioFilePath = path.join(slideDir, audioFileName);
                    fs.writeFileSync(audioFilePath, buffer);

                    ops.push({
                        op: 'save_audio_for_slide',
                        args: {
                            slide_index: slide.index - 1, // 0-indexed API
                            mp3_path: audioFilePath
                        }
                    });
                }

                if (ops.length > 0) {
                    const result = await runXmlCli(absolutePath, absolutePath, ops);
                    // Cleanup temp audio files
                    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}

                    if (!result.success) {
                         console.error("XML CLI Audio insertion failed:", result.error);
                         return { success: false, error: "Audio insertion failed: " + result.error };
                    }
                }
            } else {
                const audioResult = await handleAudioInsertion(absolutePath, slidesAudio);
                if (!audioResult!.success) {
                    console.error("Audio insertion failed:", audioResult!.error);
                    return { success: false, error: "Audio insertion failed: " + audioResult!.error };
                }
            }
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});



ipcMain.handle('get-video-save-path', async () => {
    const { dialog } = require('electron');
    const win = require('electron').BrowserWindow.getFocusedWindow();
    const app = require('electron').app;
    const path = require('path');

    const result = await dialog.showSaveDialog(win!, {
        title: 'Save Video As',
        defaultPath: path.join(app.getPath('documents'), 'Output.mp4'),
        filters: [{ name: 'MPEG-4 Video', extensions: ['mp4'] }]
    });

    if (result.canceled || !result.filePath) {
        return null;
    }
    return result.filePath;
});

ipcMain.handle('generate-video', async (event, { filePath, slidesAudio, videoOutputPath }) => {
    console.log('Generate Video Request (PPAM Flow)');
    const path = require('path');
    const fs = require('fs');
    const { spawn } = require('child_process');
    const os = require('os');
    const app = require('electron').app;

    // videoOutputPath is now passed in
    if (!videoOutputPath) {
        return { success: false, error: "No output path provided." };
    }
    console.log("Target Video Path:", videoOutputPath);

    // Define the Office Group Container path for sandboxed access
    const homeDir = app.getPath('home');
    const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');
    const audioSessionDir = path.join(officeContainer, 'TemporaryAudio', `session-${Date.now()}`);

    // Ensure directory exists
    try {
        fs.mkdirSync(audioSessionDir, { recursive: true });
    } catch (e) {
        console.error("Failed to create Office container dir:", e);
        return { success: false, error: "Could not create audio directory in Office container. Check permissions." };
    }

    try {
        if (process.platform === 'darwin') {
            const exportScriptPath = resolveScriptPath('export-to-video.applescript');

            // Args: outputPath, presentationPath (filePath)
            const child = spawn('osascript', [
                exportScriptPath,
                videoOutputPath,
                filePath
            ]);

            await new Promise<void>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: any) => stdout += d);
                child.stderr.on('data', (d: any) => stderr += d);
                child.on('close', (code: number) => {
                    // Note: 'save as movie' might return 0 but export continues in PPT background.
                    if (code === 0 && !stdout.includes("Error")) {
                        console.log(`Video export initiated: ${videoOutputPath}`);
                        resolve();
                    } else {
                        console.error(`Export failed: ${stderr || stdout}`);
                        reject(new Error(stdout || stderr));
                    }
                });
            });

            return { success: true, outputPath: videoOutputPath };
        } else {
            return { success: false, error: "Windows video export not implemented" };
        }

    } catch (e: any) {
        console.error('Generation failed:', e);
        return { success: false, error: e.message };
    }
});

// --- TTS Handler ---

// --- Settings Handler ---
ipcMain.handle('get-tts-provider', async () => {
    return getTtsProvider();
});

ipcMain.handle('get-speaker-mappings', async () => {
    return store.get('speakerMappings') || {};
});

ipcMain.handle('set-speaker-mappings', async (event, mappings) => {
    store.set('speakerMappings', mappings);
    return { success: true };
});

ipcMain.handle('get-gcp-key-path', async () => {
    return store.get('gcpKeyPath');
});

ipcMain.handle('set-gcp-key', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (canceled || filePaths.length === 0) {
        return { success: false };
    }

    const keyPath = filePaths[0];

    // Basic validation
    try {
        const fs = require('fs');
        const content = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        if (!content.type || content.type !== 'service_account') {
            return { success: false, error: 'Invalid Service Account Key JSON' };
        }
    } catch (err) {
        return { success: false, error: 'Invalid JSON file' };
    }

    store.set('gcpKeyPath', keyPath);
    return { success: true, path: keyPath };
});

ipcMain.handle('get-xml-cli-enabled', async () => {
    return store.get('xmlCliEnabled') || false;
});

ipcMain.handle('set-xml-cli-enabled', async (event, enabled) => {
    store.set('xmlCliEnabled', enabled);
    return { success: true };
});

// --- Remove Audio Handler ---
ipcMain.handle('remove-audio', async (event, { filePath, scope, slideIndex }) => {
    console.log(`Remove Audio request for: ${filePath}, scope: ${scope}, slideIndex: ${slideIndex}`);
    const reqPath = require('path');
    const reqFs = require('fs');

    const absolutePath = reqPath.resolve(filePath);
    if (!reqFs.existsSync(absolutePath)) {
        return { success: false, error: 'File not found' };
    }

    try {
        const useXmlCli = store.get('xmlCliEnabled') || false;

        if (useXmlCli) {
             console.log('Using XML CLI for removing audio');
             
             let targetIndex = slideIndex - 1;

             let slideIndexBefore = 1;
             if (process.platform === 'darwin') {
                 slideIndexBefore = await closePresentation(absolutePath);
             }

             // Step 1: Query slides to find the exact audio name(s)
             const queryResult = await runXmlCli(absolutePath, null, [{ op: 'get_slides', args: {} }], { skipClose: true, skipReopen: true });
             
             if (!queryResult.success) {
                  if (process.platform === 'darwin') await reopenPresentation(absolutePath, slideIndexBefore);
                  return { success: false, error: "Failed to query slide content: " + queryResult.error };
             }

             const slideData = queryResult.data && queryResult.data.results && queryResult.data.results[0] && queryResult.data.results[0].result;
             if (!slideData) {
                  if (process.platform === 'darwin') await reopenPresentation(absolutePath, slideIndexBefore);
                  return { success: false, error: "Could not find slide data" };
             }

             const deleteOps: any[] = [];

             if (scope === 'all') {
                  // Iterate through all slides and find all audio
                  slideData.forEach((slide: any, idx: number) => {
                      const slideAudio = slide.audio || [];
                      slideAudio.forEach((audio: any) => {
                          // Treat any entry in the 'audio' list as a target for deletion
                          deleteOps.push({
                              op: 'delete_audio_for_slide',
                              args: {
                                  slide_index: idx,
                                  name: audio.name
                              }
                          });
                      });
                  });
             } else {
                  // Specific slide removal
                  if (!slideData[targetIndex]) {
                       if (process.platform === 'darwin') await reopenPresentation(absolutePath, slideIndexBefore);
                       return { success: false, error: "Could not find slide data for index " + targetIndex };
                  }

                  const slideAudio = slideData[targetIndex].audio || [];
                  console.log(`Discovered audio entries on slide ${slideIndex}:`, slideAudio.map((a: any) => a.name));

                  // First preference: includes "audio"
                  let targetAudio = slideAudio.find((a: any) => a.name.toLowerCase().includes('audio'));
                  
                  // Second preference: any entry at all
                  if (!targetAudio && slideAudio.length > 0) {
                      targetAudio = slideAudio[0];
                  }

                  if (targetAudio) {
                      console.log(`Targeting audio shape: ${targetAudio.name} on slide ${slideIndex}`);
                      deleteOps.push({
                           op: 'delete_audio_for_slide',
                           args: {
                               slide_index: targetIndex,
                               name: targetAudio.name
                           }
                      });
                  }
             }

             if (deleteOps.length === 0) {
                  console.log(`No audio found to remove (Scope: ${scope}, Slide: ${slideIndex})`);
                  if (process.platform === 'darwin') await reopenPresentation(absolutePath, slideIndexBefore);
                  return { success: true };
             }

             // Step 2: Execute deletion operations
             const result = await runXmlCli(absolutePath, absolutePath, deleteOps, { skipClose: true, skipReopen: true });
             
             if (process.platform === 'darwin') await reopenPresentation(absolutePath, slideIndexBefore);

             if (!result.success) {
                  console.error("XML CLI Remove audio failed:", result.error);
                  return { success: false, error: "Remove audio failed: " + result.error };
             }
             return { success: true };
        }

        if (process.platform !== 'darwin') {
            return { success: false, error: 'Remove Audio via AppleScript is only supported on macOS.' };
        }

        const app = require('electron').app;
        const { spawn } = require('child_process');

        const homeDir = app.getPath('home');
        const officeContainer = path.join(homeDir, 'Library/Group Containers/UBF8T346G9.Office');

        const paramsPath = path.join(officeContainer, 'remove_audio_params.txt');
        const paramsContent = `${absolutePath}|${scope}|${slideIndex || 0}`;
        fs.writeFileSync(paramsPath, paramsContent, 'utf8');

        const scriptPath = resolveScriptPath('trigger-macro.applescript');

        const child = spawn('osascript', [
            scriptPath,
            "RemoveAudio",
            absolutePath
        ]);

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d: any) => stdout += d.toString());
            child.stderr.on('data', (d: any) => stderr += d.toString());
            child.on('close', (code: number) => {
                if (code === 0 && !stdout.includes("Error")) {
                    console.log(`RemoveAudio macro triggered.`);
                    resolve({ success: true });
                } else {
                    console.error(`Failed to trigger RemoveAudio: ${stderr} ${stdout}`);
                    resolve({ success: false, error: stdout || stderr });
                }
            });
        });

    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// --- Play Slide Handler ---
// --- Play Slide Handler ---
ipcMain.handle('play-slide', async (event, slideIndex) => {
    if (process.platform === 'darwin') {
        const scriptPath = resolveScriptPath('play-slide.applescript');
        return new Promise((resolve) => {
            const child = spawn('osascript', [scriptPath, slideIndex.toString()]);

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                output += data.toString();
            });

            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('close', (code) => {
                console.log("Play Slide Output:", output);

                if (code === 0) {
                    if (output.includes("Error")) {
                        console.error("Play Slide Script Error:", output);
                        resolve({ success: false, error: output.trim() });

                    } else {
                        resolve({ success: true });
                    }
                } else {
                    console.error("Play Slide failed:", errorOutput);
                    resolve({ success: false, error: errorOutput || 'Unknown error playing slide' });
                }
            });
        });
    } else {
        return { success: false, error: 'Play Slide is only supported on macOS for now.' };
    }
});

// --- Sync Slide Handler ---
ipcMain.handle('sync-slide', async (event, { filePath, slideIndex }) => {
    if (process.platform !== 'darwin') {
        return { success: false, error: 'Sync Slide is only supported on macOS.' };
    }

    try {
        const path = require('path');
        const fs = require('fs');
        const { spawn } = require('child_process');

        // Resolve absolute path (matches convert-pptx)
        const absolutePath = path.resolve(filePath);

        // Use app temp directory (matches convert-pptx)
        const tempDir = app.getPath('temp');
        const outputDir = path.join(tempDir, 'ppt-viewer', path.basename(absolutePath, path.extname(absolutePath)));

        if (!fs.existsSync(outputDir)) {
            return { success: false, error: 'Conversion directory not found. Please sync all first.' };
        }

        // 2. Run AppleScript
        const scriptPath = resolveScriptPath('sync-slide.applescript');

        // slideIndex is 1-based from frontend usually, let's verify
        // The script expects 1-based index (PowerPoint standard)

        const child = spawn('osascript', [
            scriptPath,
            absolutePath,
            slideIndex.toString(),
            outputDir
        ]);

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: any) => stdout += data.toString());
            child.stderr.on('data', (data: any) => stderr += data.toString());

            child.on('close', (code: number) => {
                if (code === 0 && !stdout.includes("Error")) {
                    try {
                        // Parse Output: "slides/SlideX.png|||Notes Content"
                        const parts = stdout.trim().split('|||');
                        if (parts.length < 2) throw new Error("Invalid script output: " + stdout);

                        const imageRelPath = parts[0];
                        const newNotes = parts[1] || ''; // Notes might be empty

                        // 3. Update Manifest
                        const manifestPath = path.join(outputDir, 'manifest.json');
                        const manifestData = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
                        const slides = JSON.parse(manifestData);

                        // Find slide by index (1-based)
                        const slide = slides.find((s: any) => s.index === slideIndex);

                        if (slide) {
                            // Update existing
                            slide.image = imageRelPath;
                            slide.notes = newNotes;
                        } else {
                            // New slide? If explicit sync-slide is called on a new slide index, we might need to append?
                            // Usually this is called for an *existing* known slide.
                            // If user added a slide and tries to sync it, we might not know its index yet if we haven't refreshed full list.
                            // So granular sync is best for *updating* existing.
                            // However, let's allow adding if it returns a higher index than currently known?
                            // But usually we sync by index. If index > slides.length, it's new.
                            slides.push({ index: slideIndex, image: imageRelPath, notes: newNotes });
                            // Sort by index just in case
                            slides.sort((a: any, b: any) => a.index - b.index);
                        }

                        // Write back Manifest
                        fs.writeFileSync(manifestPath, JSON.stringify(slides, null, 2), 'utf8');

                        // Return Updated Slides (formatted for frontend)
                        const slidesWithPaths = slides.map((s: any) => ({
                            ...s,
                            src: s.image ? `file://${path.join(outputDir, s.image)}?t=${Date.now()}` : null,
                            notes: s.notes ? s.notes.replace(/\\n/g, '\n') : ''
                        })).filter((s: any) => s.src !== null);

                        // Focus App Back
                        const window = BrowserWindow.fromWebContents(event.sender);
                        if (window) {
                            window.show();
                            window.focus();
                        }

                        resolve({ success: true, slides: slidesWithPaths });

                    } catch (e: any) {
                        console.error("Sync parsing error:", e);
                        resolve({ success: false, error: e.message });
                    }
                } else {
                    console.error("Sync Slide failed:", stderr || stdout);
                    resolve({ success: false, error: stderr || stdout || 'Unknown error syncing slide' });
                }
            });
        });

    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// --- TTS Handler ---
ipcMain.handle('get-voices', async () => {
    console.log(`Get Voices Request. Fetching from all configured providers...`);
    const keyPath = getGcpKeyPath();
    const voices: any[] = [];

    // 1. Fetch Google Cloud Voices
    try {
        if (keyPath) {
            const options: any = { keyFilename: keyPath };
            const client = new TextToSpeechClient(options);
            // Fetch en-GB Chirp 3 HD voices (UK)
            const [gbResult] = await client.listVoices({ languageCode: 'en-GB' });
            if (gbResult.voices) {
                const gbGcpVoices = gbResult.voices
                    .filter(v => v.name && v.name.includes('Chirp3-HD'))
                    .map(v => ({ ...v, provider: 'gcp' }));
                voices.push(...gbGcpVoices);
            }

            // Fetch en-US Chirp 3 HD voices
            const [usResult] = await client.listVoices({ languageCode: 'en-US' });
            if (usResult.voices) {
                const usGcpVoices = usResult.voices
                    .filter(v => v.name && v.name.includes('Chirp3-HD'))
                    .map(v => ({ ...v, provider: 'gcp' }));
                voices.push(...usGcpVoices);
            }
        } else {
            console.warn("GOOGLE_APPLICATION_CREDENTIALS is not set; skipping GCP voices.");
        }
    } catch (error) {
        console.error("Failed to list GCP voices:", error);
    }

    // 2. Add Local Voices
    // TODO: Ideally we'd ping the local server's /api/voices endpoint if it had one.
    // For now, we hardcode the known local fallback voices.
    voices.push(
        { name: 'en_UK/apope_low', ssmlGender: 'MALE', languageCodes: ['en-GB'], provider: 'local' },
        { name: 'en_US/cmu-arctic_low', ssmlGender: 'NEUTRAL', languageCodes: ['en-US'], provider: 'local' },
        { name: 'default', ssmlGender: 'NEUTRAL', languageCodes: ['en-US'], provider: 'local' }
    );

    return voices;
});

ipcMain.handle('generate-speech', async (event, { text, voiceOption }) => {
    const provider = voiceOption && voiceOption.provider ? voiceOption.provider : getTtsProvider();

    console.log(`TTS Request: "${text.substring(0, 20)}..." using provider: ${provider}, voice: ${voiceOption ? voiceOption.name : 'default'}`);

    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const app = require('electron').app;
    
    let cachePath = '';
    try {
        const cacheDir = path.join(app.getPath('userData'), 'tts_cache');
        if (!fs.existsSync(cacheDir)) {
             fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        const voiceStr = voiceOption ? JSON.stringify(voiceOption) : 'default';
        const hash = crypto.createHash('sha256').update(text + voiceStr + provider).digest('hex');
        cachePath = path.join(cacheDir, `${hash}.mp3`);
        
        if (fs.existsSync(cachePath)) {
            console.log(`Serving TTS from persistent cache: ${hash}`);
            const buffer = fs.readFileSync(cachePath);
            return new Uint8Array(buffer);
        }
    } catch (e) {
        console.error("TTS Cache read error:", e);
    }

    try {
        if (provider === 'gcp') {
            // --- Google Cloud TTS ---
            const keyPath = getGcpKeyPath();
            if (!keyPath) {
                throw new Error("TTS_PROVIDER is 'gcp' but GOOGLE_APPLICATION_CREDENTIALS is not set");
            }

            const options: any = {};
            if (keyPath) {
                options.keyFilename = keyPath;
            }

            const client = new TextToSpeechClient(options);

            // Detect SSML (basic check for tags)
            const isSsml = /<[^>]+>/.test(text);

            let input: any;
            if (isSsml) {
                // Ensure it's wrapped in <speak>
                let ssmlText = text;
                if (!ssmlText.trim().startsWith('<speak>')) {
                    ssmlText = `<speak>${ssmlText}</speak>`;
                }
                input = { ssml: ssmlText };
                console.log('Sending SSML request to GCP:', ssmlText);
            } else {
                input = { text: text };
            }

            const request: any = {
                input: input,
                // Use selected voice or default
                voice: voiceOption ? { languageCode: voiceOption.languageCodes[0], name: voiceOption.name } : { languageCode: 'en-US', name: 'en-US-Journey-F' },
                audioConfig: { audioEncoding: 'MP3' },
            };

            const [response] = await client.synthesizeSpeech(request);
            
            try {
                if (cachePath && response.audioContent) {
                    fs.writeFileSync(cachePath, Buffer.from(response.audioContent));
                }
            } catch (e) {
                console.error("Failed to write GCP TTS cache:", e);
            }
            
            return response.audioContent; // This is Uint8Array or Buffer

        } else {
            // --- Local TTS (Dev) ---
            // Default to local server
            const localUrl = process.env.LOCAL_TTS_URL || 'http://localhost:59125/api/tts';
            // Use selected voice name if available, else env default, else hardcoded default
            const voice = (voiceOption && voiceOption.name) || process.env.LOCAL_TTS_VOICE || 'en_UK/apope_low';

            // Detect SSML (basic check for tags)
            const isSsml = /<[^>]+>/.test(text);
            let ssmlBody = text;

            if (!isSsml) {
                // If the user isn't providing raw SSML, wrap the text in a <voice> tag 
                // so the local TTS server respects the voice selection when ssml=true.
                ssmlBody = `<speak><voice name="${voice}">${ssmlBody}</voice></speak>`;
            } else if (!ssmlBody.trim().startsWith('<speak>')) {
                ssmlBody = `<speak>${ssmlBody}</speak>`;
            }

            // Construct URL with params
            const url = new URL(localUrl);
            url.searchParams.append('voice', voice); // Fallback if API needs it
            url.searchParams.append('ssml', 'true');

            // Clean text (basic) while preserving tags
            const sanitizedText = ssmlBody.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

            const resp = await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: sanitizedText
            });

            if (!resp.ok) {
                throw new Error(`Local TTS failed: ${resp.status} ${resp.statusText}`);
            }

            const arrayBuffer = await resp.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            try {
                if (cachePath) {
                    fs.writeFileSync(cachePath, Buffer.from(uint8Array));
                }
            } catch (e) {
                console.error("Failed to write Local TTS cache:", e);
            }
            
            return uint8Array;
        }
    } catch (error: any) {
        console.error("TTS generation failed:", error);
        throw new Error(error.message || "Unknown TTS error");
    }
});

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load .env
dotenv.config();

import Store from 'electron-store';
const store = new Store();

// --- Helper to get GCP Key Path ---
function getGcpKeyPath(): string | undefined {
    // Priority: 1. ENV var (dev/runtime override, resolve to absolute if provided)
    const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (envPath) {
        const resolvedPath = path.resolve(envPath);
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
            return resolvedPath;
        } else {
            console.warn(`GOOGLE_APPLICATION_CREDENTIALS path not found or not a file: ${resolvedPath}`);
        }
    }
    
    // 2. Stored path from Settings GUI
    return store.get('gcpKeyPath') as string;
}

function getTtsProvider(): string {
    // Priority: 1. ENV var, 2. Stored Key -> implies GCP, 3. Default to GCP (so we prompt for key)
    if (process.env.TTS_PROVIDER) return process.env.TTS_PROVIDER;
    if (getGcpKeyPath()) return 'gcp';
    return 'gcp'; // Default to GCP instead of local, so we hit the "missing key" check
}

import { PptProvider } from './platform/PptProvider.js';
import { MacPptProvider } from './platform/MacPptProvider.js';
import { WindowsPptProvider } from './platform/WindowsPptProvider.js';
import { XmlPptProvider } from './platform/XmlPptProvider.js';
import { TtsManager } from './tts/TtsManager.js';
const ttsManager = new TtsManager(getTtsProvider(), getGcpKeyPath);

let basePptProvider: PptProvider;
if (process.platform === 'darwin') {
    basePptProvider = new MacPptProvider();
} else {
    basePptProvider = new WindowsPptProvider();
}

function getActivePptProvider(): PptProvider {
    const useXmlCli = store.get('xmlCliEnabled') || false;
    return useXmlCli ? new XmlPptProvider(basePptProvider) : basePptProvider;
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
const squirrelStartup = require('electron-squirrel-startup');
if (squirrelStartup) {
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

    if (!app.isPackaged && !( process.env.NODE_ENV === "test" )) {
        mainWindow.loadURL('http://localhost:5173');
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

// ==========================================
// File & Dialog Handlers
// ==========================================
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});

ipcMain.handle('get-video-save-path', async () => {
    const win = BrowserWindow.getFocusedWindow();
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

// ==========================================
// PowerPoint Lifecycle Handlers
// ==========================================
ipcMain.handle('convert-pptx', async (event, filePath) => {
    console.log('Convert request for (raw):', filePath);
    const absolutePath = path.resolve(filePath);
    console.log('Convert request for (absolute):', absolutePath);

    if (!fs.existsSync(absolutePath)) {
        return { success: false, error: `File not found: ${absolutePath}` };
    }

    const tempDir = app.getPath('temp');
    const outputDir = path.join(tempDir, 'power-narrator', path.basename(absolutePath, path.extname(absolutePath)));
    
    return await getActivePptProvider().convertPptx(absolutePath, outputDir);
});

// ==========================================
// PowerPoint Action Handlers
// ==========================================
ipcMain.handle('save-all-notes', async (event, filePath, slides, slidesAudio) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
    return await getActivePptProvider().saveAllNotes(absolutePath, slides, slidesAudio);
});

ipcMain.handle('insert-audio', async (event, filePath, slidesAudio) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
    return await getActivePptProvider().insertAudio(absolutePath, slidesAudio);
});

ipcMain.handle('remove-audio', async (event, { filePath, scope, slideIndex }) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
    return await getActivePptProvider().removeAudio(absolutePath, scope, slideIndex);
});

ipcMain.handle('play-slide', async (event, { filePath, slideIndex }) => {
    const absolutePath = path.resolve(filePath);
    return await getActivePptProvider().playSlide(absolutePath, slideIndex);
});

ipcMain.handle('reload-slide', async (event, { filePath, slideIndex }) => {
    const absolutePath = path.resolve(filePath);
    const tempDir = app.getPath('temp');
    const outputDir = path.join(tempDir, 'power-narrator', path.basename(absolutePath, path.extname(absolutePath)));
    
    if (!fs.existsSync(outputDir)) {
        return { success: false, error: 'Conversion directory not found. Please sync all first.' };
    }
    return await getActivePptProvider().reloadSlide(absolutePath, slideIndex, outputDir);
});

ipcMain.handle('generate-video', async (event, { filePath, slidesAudio, videoOutputPath }) => {
    if (!videoOutputPath) return { success: false, error: "No output path provided." };
    const absolutePath = path.resolve(filePath);
    return await getActivePptProvider().generateVideo(absolutePath, videoOutputPath);
});

// ==========================================
// Settings Handlers
// ==========================================
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

// ==========================================
// TTS Handlers
// ==========================================
ipcMain.handle('get-voices', async () => {
    return await ttsManager.getVoices();
});

ipcMain.handle('generate-speech', async (event, { text, voiceOption }) => {
    return await ttsManager.generateSpeech(text, voiceOption);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env
dotenv_1.default.config();
const electron_store_1 = __importDefault(require("electron-store"));
const store = new electron_store_1.default();
// --- Helper to get GCP Key Path ---
function getGcpKeyPath() {
    // Priority: 1. ENV var (dev/runtime override, resolve to absolute if provided)
    const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (envPath) {
        const resolvedPath = path_1.default.resolve(envPath);
        if (fs_1.default.existsSync(resolvedPath) && fs_1.default.statSync(resolvedPath).isFile()) {
            return resolvedPath;
        }
        else {
            console.warn(`GOOGLE_APPLICATION_CREDENTIALS path not found or not a file: ${resolvedPath}`);
        }
    }
    // 2. Stored path from Settings GUI
    return store.get('gcpKeyPath');
}
function getTtsProvider() {
    // Priority: 1. ENV var, 2. Stored Key -> implies GCP, 3. Default to GCP (so we prompt for key)
    if (process.env.TTS_PROVIDER)
        return process.env.TTS_PROVIDER;
    if (getGcpKeyPath())
        return 'gcp';
    return 'gcp'; // Default to GCP instead of local, so we hit the "missing key" check
}
const MacPptProvider_1 = require("./platform/MacPptProvider");
const WindowsPptProvider_1 = require("./platform/WindowsPptProvider");
const XmlPptProvider_1 = require("./platform/XmlPptProvider");
const TtsManager_1 = require("./tts/TtsManager");
const ttsManager = new TtsManager_1.TtsManager(getTtsProvider(), getGcpKeyPath);
let basePptProvider;
if (process.platform === 'darwin') {
    basePptProvider = new MacPptProvider_1.MacPptProvider();
}
else {
    basePptProvider = new WindowsPptProvider_1.WindowsPptProvider();
}
function getActivePptProvider() {
    const useXmlCli = store.get('xmlCliEnabled') || false;
    return useXmlCli ? new XmlPptProvider_1.XmlPptProvider(basePptProvider) : basePptProvider;
}
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    electron_1.app.quit();
}
const createWindow = () => {
    const mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false // Optional, but helps avoid some local file loading issues
        },
    });
    if (!electron_1.app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
        // Optional: Open DevTools on specific key combination for debugging production builds
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.control && input.shift && input.key.toLowerCase() === 'i') {
                mainWindow.webContents.toggleDevTools();
                event.preventDefault();
            }
        });
    }
};
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// ==========================================
// File & Dialog Handlers
// ==========================================
electron_1.ipcMain.handle('select-file', async () => {
    const result = await electron_1.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});
electron_1.ipcMain.handle('get-video-save-path', async () => {
    const win = electron_1.BrowserWindow.getFocusedWindow();
    const result = await electron_1.dialog.showSaveDialog(win, {
        title: 'Save Video As',
        defaultPath: path_1.default.join(electron_1.app.getPath('documents'), 'Output.mp4'),
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
electron_1.ipcMain.handle('convert-pptx', async (event, filePath) => {
    console.log('Convert request for (raw):', filePath);
    const absolutePath = path_1.default.resolve(filePath);
    console.log('Convert request for (absolute):', absolutePath);
    if (!fs_1.default.existsSync(absolutePath)) {
        return { success: false, error: `File not found: ${absolutePath}` };
    }
    const tempDir = electron_1.app.getPath('temp');
    const outputDir = path_1.default.join(tempDir, 'ppt-viewer', path_1.default.basename(absolutePath, path_1.default.extname(absolutePath)));
    return await getActivePptProvider().convertPptx(absolutePath, outputDir);
});
// ==========================================
// PowerPoint Action Handlers
// ==========================================
electron_1.ipcMain.handle('save-all-notes', async (event, filePath, slides, slidesAudio) => {
    const absolutePath = path_1.default.resolve(filePath);
    if (!fs_1.default.existsSync(absolutePath))
        return { success: false, error: 'File not found' };
    return await getActivePptProvider().saveAllNotes(absolutePath, slides, slidesAudio);
});
electron_1.ipcMain.handle('insert-audio', async (event, filePath, slidesAudio) => {
    const absolutePath = path_1.default.resolve(filePath);
    if (!fs_1.default.existsSync(absolutePath))
        return { success: false, error: 'File not found' };
    return await getActivePptProvider().insertAudio(absolutePath, slidesAudio);
});
electron_1.ipcMain.handle('remove-audio', async (event, { filePath, scope, slideIndex }) => {
    const absolutePath = path_1.default.resolve(filePath);
    if (!fs_1.default.existsSync(absolutePath))
        return { success: false, error: 'File not found' };
    return await getActivePptProvider().removeAudio(absolutePath, scope, slideIndex);
});
electron_1.ipcMain.handle('play-slide', async (event, slideIndex) => {
    return await getActivePptProvider().playSlide(slideIndex);
});
electron_1.ipcMain.handle('reload-slide', async (event, { filePath, slideIndex }) => {
    const absolutePath = path_1.default.resolve(filePath);
    const tempDir = electron_1.app.getPath('temp');
    const outputDir = path_1.default.join(tempDir, 'ppt-viewer', path_1.default.basename(absolutePath, path_1.default.extname(absolutePath)));
    if (!fs_1.default.existsSync(outputDir)) {
        return { success: false, error: 'Conversion directory not found. Please sync all first.' };
    }
    return await getActivePptProvider().reloadSlide(absolutePath, slideIndex, outputDir);
});
electron_1.ipcMain.handle('generate-video', async (event, { filePath, slidesAudio, videoOutputPath }) => {
    if (!videoOutputPath)
        return { success: false, error: "No output path provided." };
    const absolutePath = path_1.default.resolve(filePath);
    return await getActivePptProvider().generateVideo(absolutePath, videoOutputPath);
});
// ==========================================
// Settings Handlers
// ==========================================
electron_1.ipcMain.handle('get-tts-provider', async () => {
    return getTtsProvider();
});
electron_1.ipcMain.handle('get-speaker-mappings', async () => {
    return store.get('speakerMappings') || {};
});
electron_1.ipcMain.handle('set-speaker-mappings', async (event, mappings) => {
    store.set('speakerMappings', mappings);
    return { success: true };
});
electron_1.ipcMain.handle('get-gcp-key-path', async () => {
    return store.get('gcpKeyPath');
});
electron_1.ipcMain.handle('set-gcp-key', async () => {
    const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || filePaths.length === 0) {
        return { success: false };
    }
    const keyPath = filePaths[0];
    // Basic validation
    try {
        const content = JSON.parse(fs_1.default.readFileSync(keyPath, 'utf8'));
        if (!content.type || content.type !== 'service_account') {
            return { success: false, error: 'Invalid Service Account Key JSON' };
        }
    }
    catch (err) {
        return { success: false, error: 'Invalid JSON file' };
    }
    store.set('gcpKeyPath', keyPath);
    return { success: true, path: keyPath };
});
electron_1.ipcMain.handle('get-xml-cli-enabled', async () => {
    return store.get('xmlCliEnabled') || false;
});
electron_1.ipcMain.handle('set-xml-cli-enabled', async (event, enabled) => {
    store.set('xmlCliEnabled', enabled);
    return { success: true };
});
// ==========================================
// TTS Handlers
// ==========================================
electron_1.ipcMain.handle('get-voices', async () => {
    return await ttsManager.getVoices();
});
electron_1.ipcMain.handle('generate-speech', async (event, { text, voiceOption }) => {
    return await ttsManager.generateSpeech(text, voiceOption);
});

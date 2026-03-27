const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'electron/main.ts');
let content = fs.readFileSync(mainPath, 'utf8');

// 1. Inject TtsManager import and instantiation after PptProvider imports
const importInjection = `import { TtsManager } from './platform/TtsManager';
const ttsManager = new TtsManager(getTtsProvider(), getGcpKeyPath);
`;
content = content.replace(/import \{ XmlPptProvider \} from '\.\/platform\/XmlPptProvider';\n/, 
    `import { XmlPptProvider } from './platform/XmlPptProvider';\n${importInjection}`);

// 2. Erase the old get-voices and generate-speech handlers completely.
// Since it's from line ~243 to the end of the file, we can use a big regex or indices.
// Let's find ipcMain.handle('get-voices'
const getVoicesIndex = content.indexOf(`ipcMain.handle('get-voices'`);
if (getVoicesIndex !== -1) {
    // Keep everything up to this point
    content = content.substring(0, getVoicesIndex);
    
    // Append the new handlers
    content += `ipcMain.handle('get-voices', async () => {
    return await ttsManager.getVoices();
});

ipcMain.handle('generate-speech', async (event, { text, voiceOption }) => {
    return await ttsManager.generateSpeech(text, voiceOption);
});
`;
} else {
    console.error("Could not find get-voices handler!");
    process.exit(1);
}

fs.writeFileSync(mainPath, content, 'utf8');
console.log('Successfully replaced TTS IPC handlers via script.');

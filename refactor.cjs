const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'electron/main.ts');
let content = fs.readFileSync(mainPath, 'utf8');

// 1. Remove handleAudioInsertion completely
content = content.replace(/\/\/ --- Helper for Audio Insertion ---[\s\S]*?^}\n/m, '');

// 2. Replace save-all-notes
content = content.replace(/ipcMain\.handle\('save-all-notes'[\s\S]*?^}\);\n/m, 
`ipcMain.handle('save-all-notes', async (event, filePath, slides, slidesAudio) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
    return await getActivePptProvider().saveAllNotes(absolutePath, slides, slidesAudio);
});\n`);

// 3. Replace insert-audio
content = content.replace(/ipcMain\.handle\('insert-audio'[\s\S]*?^}\);\n/m,
`ipcMain.handle('insert-audio', async (event, filePath, slidesAudio) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
    return await getActivePptProvider().insertAudio(absolutePath, slidesAudio);
});\n`);

// 4. Replace generate-video
content = content.replace(/ipcMain\.handle\('generate-video'[\s\S]*?^}\);\n/m,
`ipcMain.handle('generate-video', async (event, { filePath, slidesAudio, videoOutputPath }) => {
    if (!videoOutputPath) return { success: false, error: "No output path provided." };
    const absolutePath = path.resolve(filePath);
    return await getActivePptProvider().generateVideo(absolutePath, videoOutputPath);
});\n`);

// 5. Replace remove-audio
content = content.replace(/ipcMain\.handle\('remove-audio'[\s\S]*?^}\);\n/m,
`ipcMain.handle('remove-audio', async (event, { filePath, scope, slideIndex }) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return { success: false, error: 'File not found' };
    return await getActivePptProvider().removeAudio(absolutePath, scope, slideIndex);
});\n`);

// 6. Replace play-slide
content = content.replace(/ipcMain\.handle\('play-slide'[\s\S]*?^}\);\n/m,
`ipcMain.handle('play-slide', async (event, slideIndex) => {
    return await getActivePptProvider().playSlide(slideIndex);
});\n`);

// 7. Replace sync-slide
content = content.replace(/ipcMain\.handle\('sync-slide'[\s\S]*?^}\);\n/m,
`ipcMain.handle('sync-slide', async (event, { filePath, slideIndex }) => {
    const absolutePath = path.resolve(filePath);
    const tempDir = require('electron').app.getPath('temp');
    const outputDir = path.join(tempDir, 'ppt-viewer', path.basename(absolutePath, path.extname(absolutePath)));
    
    if (!fs.existsSync(outputDir)) {
        return { success: false, error: 'Conversion directory not found. Please sync all first.' };
    }
    return await getActivePptProvider().syncSlide(absolutePath, slideIndex, outputDir);
});\n`);

fs.writeFileSync(mainPath, content, 'utf8');
console.log('Successfully replaced IPC handlers via regex block targeting.');

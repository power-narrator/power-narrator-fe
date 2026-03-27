"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// When contextIsolation is false, we can attach directly to window
window.electronAPI = {
    convertPptx: (filePath) => electron_1.ipcRenderer.invoke('convert-pptx', filePath),
    onConversionUpdate: (callback) => electron_1.ipcRenderer.on('conversion-update', callback),
    getPathForFile: (file) => file.path,
    selectFile: () => electron_1.ipcRenderer.invoke('select-file'),
    saveAllNotes: (filePath, slides) => electron_1.ipcRenderer.invoke('save-all-notes', filePath, slides),
    getVoices: () => electron_1.ipcRenderer.invoke('get-voices'),
    getGcpKeyPath: () => electron_1.ipcRenderer.invoke('get-gcp-key-path'),
    setGcpKey: () => electron_1.ipcRenderer.invoke('set-gcp-key'),
    getSpeakerMappings: () => electron_1.ipcRenderer.invoke('get-speaker-mappings'),
    setSpeakerMappings: (mappings) => electron_1.ipcRenderer.invoke('set-speaker-mappings', mappings),
    getTtsProvider: () => electron_1.ipcRenderer.invoke('get-tts-provider'),
    getXmlCliEnabled: () => electron_1.ipcRenderer.invoke('get-xml-cli-enabled'),
    setXmlCliEnabled: (enabled) => electron_1.ipcRenderer.invoke('set-xml-cli-enabled', enabled),
};

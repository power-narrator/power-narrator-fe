import { contextBridge, ipcRenderer, webUtils } from 'electron';

// When contextIsolation is false, we can attach directly to window
(window as any).electronAPI = {
    convertPptx: (filePath: string) => ipcRenderer.invoke('convert-pptx', filePath),
    onConversionUpdate: (callback: (event: any, value: any) => void) => ipcRenderer.on('conversion-update', callback),
    getPathForFile: (file: File) => (file as any).path,
    selectFile: () => ipcRenderer.invoke('select-file'),
    saveAllNotes: (filePath: string, slides: any[]) => ipcRenderer.invoke('save-all-notes', filePath, slides),
    getVoices: () => ipcRenderer.invoke('get-voices'),
    getGcpKeyPath: () => ipcRenderer.invoke('get-gcp-key-path'),
    setGcpKey: () => ipcRenderer.invoke('set-gcp-key'),
    getSpeakerMappings: () => ipcRenderer.invoke('get-speaker-mappings'),
    setSpeakerMappings: (mappings: Record<string, any>) => ipcRenderer.invoke('set-speaker-mappings', mappings),
    getTtsProvider: () => ipcRenderer.invoke('get-tts-provider'),
    getXmlCliEnabled: () => ipcRenderer.invoke('get-xml-cli-enabled'),
    setXmlCliEnabled: (enabled: boolean) => ipcRenderer.invoke('set-xml-cli-enabled', enabled),
};

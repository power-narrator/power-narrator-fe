import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  convertPptx: (filePath: string) => ipcRenderer.invoke("convert-pptx", filePath),
  onConversionUpdate: (callback: (event: unknown, value: unknown) => void) => {
    ipcRenderer.on("conversion-update", callback);
  },
  getPathForFile: (file: File) => (file as File & { path?: string }).path ?? "",
  selectFile: () => ipcRenderer.invoke("select-file"),
  saveAllNotes: (filePath: string, slides: unknown[]) =>
    ipcRenderer.invoke("save-all-notes", filePath, slides),
  getVoices: () => ipcRenderer.invoke("get-voices"),
  generateSpeech: (payload: {
    text: string;
    voiceOption?: {
      name: string;
      languageCodes: string[];
      ssmlGender: string;
      provider?: string;
    };
  }) => ipcRenderer.invoke("generate-speech", payload),
  getGcpKeyPath: () => ipcRenderer.invoke("get-gcp-key-path"),
  setGcpKey: () => ipcRenderer.invoke("set-gcp-key"),
  getSpeakerMappings: () => ipcRenderer.invoke("get-speaker-mappings"),
  setSpeakerMappings: (mappings: Record<string, unknown>) =>
    ipcRenderer.invoke("set-speaker-mappings", mappings),
  getTtsProvider: () => ipcRenderer.invoke("get-tts-provider"),
  getXmlCliEnabled: () => ipcRenderer.invoke("get-xml-cli-enabled"),
  setXmlCliEnabled: (enabled: boolean) => ipcRenderer.invoke("set-xml-cli-enabled", enabled),
  insertAudio: (filePath: string, slidesAudio: unknown[]) =>
    ipcRenderer.invoke("insert-audio", filePath, slidesAudio),
  generateVideo: (payload: { filePath: string; videoOutputPath: string }) =>
    ipcRenderer.invoke("generate-video", payload),
  removeAudio: (payload: { filePath: string; scope: "slide" | "all"; slideIndex: number }) =>
    ipcRenderer.invoke("remove-audio", payload),
  playSlide: (slideIndex: number, filePath: string) =>
    ipcRenderer.invoke("play-slide", { filePath, slideIndex }),
  reloadSlide: (payload: { filePath: string; slideIndex: number }) =>
    ipcRenderer.invoke("reload-slide", payload),
  getVideoSavePath: () => ipcRenderer.invoke("get-video-save-path"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

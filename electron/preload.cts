import { contextBridge, ipcRenderer } from "electron";
import type {
  BasicPptResult,
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  SlidePptResult,
  SetGcpKeyResult,
  SlideManifestEntry,
  SlideAudioEntry,
  SlidesPptResult,
  VideoPptResult,
} from "./platform/types.js";

interface Voice {
  name: string;
  languageCodes: string[];
  ssmlGender: string;
  provider: string;
}

const electronAPI = {
  convertPptx: (filePath: string): Promise<SlidesPptResult> =>
    ipcRenderer.invoke("convert-pptx", filePath),
  onConversionUpdate: (callback: (event: unknown, value: unknown) => void) => {
    ipcRenderer.on("conversion-update", callback);
  },
  getPathForFile: (file: File) => (file as File & { path?: string }).path ?? "",
  selectFile: (): Promise<string | null> => ipcRenderer.invoke("select-file"),
  saveNotes: (filePath: string, slides: SlideManifestEntry[]): Promise<BasicPptResult> =>
    ipcRenderer.invoke("save-notes", filePath, slides),
  getVoices: (): Promise<Voice[]> => ipcRenderer.invoke("get-voices"),
  generateSpeech: (payload: {
    text: string;
    voiceOption?: {
      name: string;
      languageCodes: string[];
      ssmlGender: string;
      provider?: string;
    };
  }): Promise<Uint8Array> => ipcRenderer.invoke("generate-speech", payload),
  getGcpKeyPath: (): Promise<string | null> => ipcRenderer.invoke("get-gcp-key-path"),
  setGcpKey: (): Promise<SetGcpKeyResult> => ipcRenderer.invoke("set-gcp-key"),
  getSpeakerMappings: (): Promise<Record<string, Voice>> =>
    ipcRenderer.invoke("get-speaker-mappings"),
  setSpeakerMappings: (mappings: Record<string, Voice>): Promise<BasicPptResult> =>
    ipcRenderer.invoke("set-speaker-mappings", mappings),
  getTtsProvider: (): Promise<"gcp" | "local"> => ipcRenderer.invoke("get-tts-provider"),
  getXmlCliEnabled: (): Promise<boolean> => ipcRenderer.invoke("get-xml-cli-enabled"),
  setXmlCliEnabled: (enabled: boolean): Promise<BasicPptResult> =>
    ipcRenderer.invoke("set-xml-cli-enabled", enabled),
  insertAudio: (filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> =>
    ipcRenderer.invoke("insert-audio", filePath, slidesAudio),
  generateVideo: (payload: GenerateVideoRequest): Promise<VideoPptResult> =>
    ipcRenderer.invoke("generate-video", payload),
  removeAudio: (payload: RemoveAudioRequest): Promise<BasicPptResult> =>
    ipcRenderer.invoke("remove-audio", payload),
  playSlide: (payload: PlaySlideRequest): Promise<BasicPptResult> =>
    ipcRenderer.invoke("play-slide", payload),
  reloadSlide: (payload: ReloadSlideRequest): Promise<SlidePptResult> =>
    ipcRenderer.invoke("reload-slide", payload),
  getVideoSavePath: (): Promise<string | null> => ipcRenderer.invoke("get-video-save-path"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

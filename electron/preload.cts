const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
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
import type { GenerateSpeechRequest, TtsProviderId, Voice } from "../shared/types/tts.js";
import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarratedSlideSaveRequest,
  NarrationPreparationProgress,
  PreviewNarrationRequest,
} from "../shared/types/narration.js";
let narratedPresentationRequestId = 0;

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
  saveNarratedSlide: (payload: NarratedSlideSaveRequest): Promise<NarratedSaveResult> =>
    ipcRenderer.invoke("save-narrated-slide", payload),
  saveNarratedPresentation: async (
    payload: NarratedPresentationSaveRequest,
    onProgress: (progress: NarrationPreparationProgress) => void,
  ): Promise<NarratedSaveResult> => {
    narratedPresentationRequestId += 1;
    const progressChannel = `narrated-presentation-save-progress:${narratedPresentationRequestId}`;
    const listener = (_event: unknown, progress: NarrationPreparationProgress) => {
      onProgress(progress);
    };
    ipcRenderer.on(progressChannel, listener);
    try {
      return await ipcRenderer.invoke("save-narrated-presentation", {
        ...payload,
        progressChannel,
      });
    } finally {
      ipcRenderer.removeListener(progressChannel, listener);
    }
  },
  getVoices: (): Promise<Voice[]> => ipcRenderer.invoke("get-voices"),
  generateSpeech: (payload: GenerateSpeechRequest): Promise<Uint8Array> =>
    ipcRenderer.invoke("generate-speech", payload),
  prepareNarrationPreview: (payload: PreviewNarrationRequest): Promise<Uint8Array | null> =>
    ipcRenderer.invoke("prepare-narration-preview", payload),
  getGcpKeyPath: (): Promise<string | null> => ipcRenderer.invoke("get-gcp-key-path"),
  setGcpKey: (): Promise<SetGcpKeyResult> => ipcRenderer.invoke("set-gcp-key"),
  getSpeakerMappings: (): Promise<Record<string, Voice>> =>
    ipcRenderer.invoke("get-speaker-mappings"),
  setSpeakerMappings: (mappings: Record<string, Voice>): Promise<BasicPptResult> =>
    ipcRenderer.invoke("set-speaker-mappings", mappings),
  getTtsProvider: (): Promise<TtsProviderId> => ipcRenderer.invoke("get-tts-provider"),
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
  setHasUnsavedNarrationChanges: (hasChanges: boolean): void =>
    ipcRenderer.sendSync("set-has-unsaved-narration-changes", hasChanges),
  confirmDiscardNarrationChanges: (): Promise<boolean> =>
    ipcRenderer.invoke("confirm-discard-narration-changes"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

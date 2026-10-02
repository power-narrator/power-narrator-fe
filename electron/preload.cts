// Electron preload scripts must be CommonJS; `import` is not supported here.
// oxlint-disable-next-line typescript/no-require-imports
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
import type {
  BasicPptResult,
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  VideoPptResult,
} from "../shared/types/powerpoint.js";
import type { StructuredSlideResult, StructuredSlidesResult } from "../shared/types/slides.js";
import type { Result } from "../shared/types/result.js";
import type { SelectGcpKeyResult, Settings } from "../shared/types/settings.js";
import type { Voice } from "../shared/types/tts.js";
import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarratedSlideSaveRequest,
  NarrationPreparationProgress,
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../shared/types/narration.js";
let narratedPresentationRequestId = 0;

const electronAPI = {
  convertPptx: (filePath: string): Promise<StructuredSlidesResult> =>
    ipcRenderer.invoke("convert-pptx", filePath),
  onConversionUpdate: (callback: (event: unknown, value: unknown) => void) => {
    ipcRenderer.on("conversion-update", callback);
  },
  getPathForFile: (file: File) => (file as File & { path?: string }).path ?? "",
  selectFile: (): Promise<string | null> => ipcRenderer.invoke("select-file"),
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
      return (await ipcRenderer.invoke("save-narrated-presentation", {
        ...payload,
        progressChannel,
      })) as NarratedSaveResult;
    } finally {
      ipcRenderer.removeListener(progressChannel, listener);
    }
  },
  getVoices: (): Promise<Voice[]> => ipcRenderer.invoke("get-voices"),
  prepareNarrationPreview: (payload: PreviewNarrationRequest): Promise<NarrationPreviewResult> =>
    ipcRenderer.invoke("prepare-narration-preview", payload),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("get-settings"),
  selectGcpKey: (): Promise<SelectGcpKeyResult> => ipcRenderer.invoke("select-gcp-key"),
  saveSettings: (settings: Settings): Promise<Result> =>
    ipcRenderer.invoke("save-settings", settings),
  getSpeakerMappings: (): Promise<Record<string, Voice>> =>
    ipcRenderer.invoke("get-speaker-mappings"),
  generateVideo: (payload: GenerateVideoRequest): Promise<VideoPptResult> =>
    ipcRenderer.invoke("generate-video", payload),
  removeAudio: (payload: RemoveAudioRequest): Promise<BasicPptResult> =>
    ipcRenderer.invoke("remove-audio", payload),
  playSlide: (payload: PlaySlideRequest): Promise<BasicPptResult> =>
    ipcRenderer.invoke("play-slide", payload),
  reloadSlide: (payload: ReloadSlideRequest): Promise<StructuredSlideResult> =>
    ipcRenderer.invoke("reload-slide", payload),
  getVideoSavePath: (): Promise<string | null> => ipcRenderer.invoke("get-video-save-path"),
  setHasUnsavedNarrationChanges: (hasChanges: boolean): void => {
    ipcRenderer.sendSync("set-has-unsaved-narration-changes", hasChanges);
  },
  confirmDiscardNarrationChanges: (): Promise<boolean> =>
    ipcRenderer.invoke("confirm-discard-narration-changes"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

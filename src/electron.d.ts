import type { Result } from "../shared/types/result";
import type { SelectGcpKeyResult, Settings, VoicePreview } from "../shared/types/settings";
import type { SpeakerMapping, VoiceOption } from "../shared/types/tts";
import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarratedSlideSaveRequest,
  SaveAllRunProgress,
  SaveAllRunResult,
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../shared/types/narration";
import type {
  BasicElectronResult,
  ConvertResponse,
  GenerateVideoPayload,
  PlaySlidePayload,
  ReloadSlidePayload,
  RemoveAudioPayload,
  SlideElectronResult,
  VideoElectronResult,
} from "./types/electron";

declare global {
  interface Window {
    electronAPI: {
      convertPptx: (filePath: string) => Promise<ConvertResponse>;
      onConversionUpdate: (callback: (event: unknown, value: unknown) => void) => void;
      getPathForFile: (file: File) => string;
      selectFile: () => Promise<string | null>;
      saveNarratedSlide: (payload: NarratedSlideSaveRequest) => Promise<NarratedSaveResult>;
      saveNarratedPresentation: (
        payload: NarratedPresentationSaveRequest,
        onProgress: (progress: SaveAllRunProgress) => void,
        onCancellable?: (cancel: () => void) => void,
      ) => Promise<SaveAllRunResult>;
      getVoices: () => Promise<VoiceOption[]>;
      prepareNarrationPreview: (
        payload: PreviewNarrationRequest,
      ) => Promise<NarrationPreviewResult>;
      getSettings: () => Promise<Settings>;
      selectGcpKey: () => Promise<SelectGcpKeyResult>;
      previewVoices: (keyPath: string) => Promise<VoicePreview>;
      saveSettings: (settings: Settings) => Promise<Result>;
      setInsertMethod: (method: string) => Promise<void>;
      getSpeakerMappings: () => Promise<Record<string, SpeakerMapping>>;
      generateVideo: (payload: GenerateVideoPayload) => Promise<VideoElectronResult>;
      removeAudio: (payload: RemoveAudioPayload) => Promise<BasicElectronResult>;
      playSlide: (payload: PlaySlidePayload) => Promise<BasicElectronResult>;
      reloadSlide: (payload: ReloadSlidePayload) => Promise<SlideElectronResult>;
      getVideoSavePath: () => Promise<string | null>;
      setHasUnsavedNarrationChanges: (hasChanges: boolean) => void;
      confirmDiscardNarrationChanges: () => Promise<boolean>;
    };
  }
}

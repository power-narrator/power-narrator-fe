import type { TtsProviderId, Voice } from "../shared/types/tts";
import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarratedSlideSaveRequest,
  NarrationPreparationProgress,
  PreviewNarrationRequest,
} from "../shared/types/narration";
import type {
  BasicElectronResult,
  ConvertResponse,
  GenerateVideoPayload,
  PlaySlidePayload,
  ReloadSlidePayload,
  RemoveAudioPayload,
  SaveNotesSlide,
  SlideElectronResult,
  SetGcpKeyResult,
  Slide,
  SlidesElectronResult,
  VideoElectronResult,
} from "./types/electron";

declare global {
  interface Window {
    electronAPI: {
      convertPptx: (filePath: string) => Promise<ConvertResponse>;
      onConversionUpdate: (callback: (event: unknown, value: unknown) => void) => void;
      getPathForFile: (file: File) => string;
      selectFile: () => Promise<string | null>;
      saveNotes: (filePath: string, slides: SaveNotesSlide[]) => Promise<BasicElectronResult>;
      saveNarratedSlide: (payload: NarratedSlideSaveRequest) => Promise<NarratedSaveResult>;
      saveNarratedPresentation: (
        payload: NarratedPresentationSaveRequest,
        onProgress: (progress: NarrationPreparationProgress) => void,
      ) => Promise<NarratedSaveResult>;
      getVoices: () => Promise<Voice[]>;
      prepareNarrationPreview: (payload: PreviewNarrationRequest) => Promise<Uint8Array>;
      getGcpKeyPath: () => Promise<string | null>;
      setGcpKey: () => Promise<SetGcpKeyResult>;
      setInsertMethod: (method: string) => Promise<void>;
      getSpeakerMappings: () => Promise<Record<string, Voice>>;
      setSpeakerMappings: (mappings: Record<string, Voice>) => Promise<BasicElectronResult>;
      getTtsProvider: () => Promise<TtsProviderId>;
      getXmlCliEnabled: () => Promise<boolean>;
      setXmlCliEnabled: (enabled: boolean) => Promise<BasicElectronResult>;
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

import type { GenerateSpeechRequest, TtsProviderId, Voice } from "../shared/types/tts";
import type { PreviewNarrationRequest, PreviewNarrationResult } from "../shared/types/narration";
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
  SlideAudioEntry,
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
      getVoices: () => Promise<Voice[]>;
      generateSpeech: (payload: GenerateSpeechRequest) => Promise<Uint8Array>;
      prepareNarrationPreview: (
        payload: PreviewNarrationRequest,
      ) => Promise<PreviewNarrationResult>;
      getGcpKeyPath: () => Promise<string | null>;
      setGcpKey: () => Promise<SetGcpKeyResult>;
      setInsertMethod: (method: string) => Promise<void>;
      getSpeakerMappings: () => Promise<Record<string, Voice>>;
      setSpeakerMappings: (mappings: Record<string, Voice>) => Promise<BasicElectronResult>;
      getTtsProvider: () => Promise<TtsProviderId>;
      getXmlCliEnabled: () => Promise<boolean>;
      setXmlCliEnabled: (enabled: boolean) => Promise<BasicElectronResult>;
      insertAudio: (
        filePath: string,
        slidesAudio: SlideAudioEntry[],
      ) => Promise<BasicElectronResult>;
      generateVideo: (payload: GenerateVideoPayload) => Promise<VideoElectronResult>;
      removeAudio: (payload: RemoveAudioPayload) => Promise<BasicElectronResult>;
      playSlide: (payload: PlaySlidePayload) => Promise<BasicElectronResult>;
      reloadSlide: (payload: ReloadSlidePayload) => Promise<SlideElectronResult>;
      getVideoSavePath: () => Promise<string | null>;
    };
  }
}

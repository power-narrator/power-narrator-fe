import type { Voice } from "./types/voice";
import type {
  BasicElectronResult,
  ConvertResponse,
  GenerateVideoPayload,
  PlaySlidePayload,
  ReloadSlidePayload,
  RemoveAudioPayload,
  SaveNotesSlide,
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
      saveAllNotes: (filePath: string, slides: SaveNotesSlide[]) => Promise<BasicElectronResult>;
      getVoices: () => Promise<Voice[]>;
      generateSpeech: (payload: {
        text: string;
        voiceOption?: {
          name: string;
          languageCodes: string[];
          ssmlGender: string;
          provider?: string;
        };
      }) => Promise<Uint8Array>;
      getGcpKeyPath: () => Promise<string | null>;
      setGcpKey: () => Promise<SetGcpKeyResult>;
      setInsertMethod: (method: string) => Promise<void>;
      getSpeakerMappings: () => Promise<Record<string, Voice>>;
      setSpeakerMappings: (mappings: Record<string, Voice>) => Promise<BasicElectronResult>;
      getTtsProvider: () => Promise<"gcp" | "local">;
      getXmlCliEnabled: () => Promise<boolean>;
      setXmlCliEnabled: (enabled: boolean) => Promise<BasicElectronResult>;
      insertAudio: (
        filePath: string,
        slidesAudio: SlideAudioEntry[],
      ) => Promise<BasicElectronResult>;
      generateVideo: (payload: GenerateVideoPayload) => Promise<VideoElectronResult>;
      removeAudio: (payload: RemoveAudioPayload) => Promise<BasicElectronResult>;
      playSlide: (payload: PlaySlidePayload) => Promise<BasicElectronResult>;
      reloadSlide: (payload: ReloadSlidePayload) => Promise<SlidesElectronResult>;
      getVideoSavePath: () => Promise<string | null>;
    };
  }
}

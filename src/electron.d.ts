import type { Voice } from "./types/voice";
import type {
  BasicElectronResult,
  ConvertResponse,
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
      saveAllNotes: (filePath: string, slides: Slide[]) => Promise<BasicElectronResult>;
      getVoices: () => Promise<Voice[]>;
      getGcpKeyPath: () => Promise<string | null>;
      setGcpKey: () => Promise<BasicElectronResult & { path?: string }>;
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
      generateVideo: (payload: {
        filePath: string;
        videoOutputPath: string;
      }) => Promise<VideoElectronResult>;
      removeAudio: (payload: {
        filePath: string;
        scope: "slide" | "all";
        slideIndex: number;
      }) => Promise<BasicElectronResult>;
      playSlide: (slideIndex: number, filePath: string) => Promise<BasicElectronResult>;
      reloadSlide: (payload: {
        filePath: string;
        slideIndex: number;
      }) => Promise<SlidesElectronResult>;
      getVideoSavePath: () => Promise<string | null>;
    };
  }
}

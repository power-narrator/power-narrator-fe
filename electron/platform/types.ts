export interface SlideManifestEntry {
  index: number;
  image: string;
  notes: string;
}

export interface SlideWithSrc extends SlideManifestEntry {
  src: string;
}

export type SlideImageMap = Record<number, { image: string }>;
export type SlideNotesMap = Record<number, string>;
export interface SlideAudioEntry {
  index: number;
  sectionIndex: number;
  audioData: Uint8Array;
}

export type ErrorResult = {
  success: false;
  message: string;
};

export type SuccessResult<T extends object = {}> = {
  success: true;
} & T;

export type Result<T extends object = {}> = SuccessResult<T> | ErrorResult;

export type BasicPptResult = Result;

export type SlidesPptResult = Result<{ slides: SlideWithSrc[] }>;

export type VideoPptResult = Result<{ outputPath: string }>;

export type SetGcpKeyResult = Result<{ path: string }>;

export type ExportSlideImagesResult = Result<{ images: SlideImageMap }>;

export type ReloadSlideImageResult = Result<{ image: string }>;

export type ReadAllSlideNotesResult = Result<{ notes: SlideNotesMap }>;

export type ReadSlideNotesResult = Result<{ notes: string }>;

export interface GenerateVideoRequest {
  filePath: string;
  videoOutputPath: string;
}

export interface PlaySlideRequest {
  filePath: string;
  slideIndex: number;
}

export interface ReloadSlideRequest {
  filePath: string;
  slideIndex: number;
}

export interface RemoveAudioRequest {
  filePath: string;
  slideIndices: number[];
}

export interface XmlSlideAudio {
  name: string;
}

export interface XmlSlideData {
  notes: string;
  audio: XmlSlideAudio[];
}

export type XmlCliOperationName =
  | "get_slides"
  | "set_slide_notes"
  | "save_audio_for_slide"
  | "delete_audio_for_slide";

export interface XmlCliOperation {
  op: XmlCliOperationName;
  args: Record<string, string | number>;
}

export interface XmlCliOperationResult {
  success: boolean;
  result: unknown;
  message: string;
}

export interface XmlCliResponse {
  results: XmlCliOperationResult[];
}

export type RunXmlCliResult = Result<{ data: XmlCliResponse }>;

export type QuerySlidesResult = Result<{ slideData: XmlSlideData[] }>;

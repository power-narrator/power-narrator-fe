export interface Slide {
  index: number;
  image: string;
  src: string;
  notes: string;
}

export interface ConvertResponse {
  success: boolean;
  slides: Slide[];
  error?: string;
}

export interface BasicElectronResult {
  success: boolean;
  error?: string;
}

export interface SlidesElectronResult extends BasicElectronResult {
  slides?: Slide[];
}

export interface VideoElectronResult extends BasicElectronResult {
  outputPath?: string;
}

export interface SlideAudioEntry {
  index: number;
  sectionIndex?: number;
  audioData: Uint8Array;
}

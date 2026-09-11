export type PreviewSpeakerChoice =
  | { kind: "effective" }
  | { kind: "default" }
  | { kind: "override"; speaker: string };

export interface PreviewNarrationRequest {
  slideIndex: number;
  sectionIndex: number;
  notes: string;
  text: string;
  speakerChoice: PreviewSpeakerChoice;
}

export interface NarrationPreviewResult {
  audio: Uint8Array;
  mediaType: string;
}

export interface NarratedSlideSaveRequest {
  filePath: string;
  slideIndex: number;
  notes: string;
}

export interface NarratedSlideInput {
  slideIndex: number;
  notes: string;
}

export interface NarratedPresentationSaveRequest {
  filePath: string;
  slides: NarratedSlideInput[];
}

export interface NarrationPreparationProgress {
  completed: number;
  total: number;
}

export type NarratedSaveFailureStage = "validation" | "synthesis" | "powerpoint";

export type NarratedSaveResult =
  | { success: true }
  | {
      success: false;
      stage: NarratedSaveFailureStage;
      partial: boolean;
      message: string;
    };

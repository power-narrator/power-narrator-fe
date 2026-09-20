import type { SlideNotePayload } from "../narration/slideNotePayload.js";

export type PreviewSpeakerChoice =
  | { kind: "effective" }
  | { kind: "default" }
  | { kind: "override"; speaker: string };

export type PreviewNarrationRequest = SlideNotePayload & {
  slideIndex: number;
  sectionIndex: number;
  text: string;
  speakerChoice: PreviewSpeakerChoice;
};

export interface NarrationPreviewResult {
  audio: Uint8Array;
  mediaType: string;
}

export type NarratedSlideSaveRequest = SlideNotePayload & {
  filePath: string;
  slideIndex: number;
};

export type NarratedSlideInput = SlideNotePayload & {
  slideIndex: number;
};

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

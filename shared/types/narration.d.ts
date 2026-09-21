import type { NarrationSection } from "../narration/NarrationSections.js";
import type { SlideIndex } from "../slides/slideCoordinates.js";

export type PreviewSpeakerChoice =
  | { kind: "effective" }
  | { kind: "default" }
  | { kind: "override"; speaker: string };

export interface PreviewNarrationRequest {
  /** The author's current slide-note sections, in the order narration positions follow. */
  sections: readonly NarrationSection[];
  slideIndex: SlideIndex;
  /** Where the section sits within its slide, counted from zero. */
  sectionIndex: number;
  text: string;
  speakerChoice: PreviewSpeakerChoice;
}

export interface NarrationPreviewResult {
  audio: Uint8Array;
  mediaType: string;
}

export interface NarratedSlideInput {
  slideIndex: SlideIndex;
  /** The author's structured sections, in the order narration positions follow. */
  sections: readonly NarrationSection[];
}

export type NarratedSlideSaveRequest = NarratedSlideInput & {
  filePath: string;
};

export interface NarratedPresentationSaveRequest {
  filePath: string;
  slides: readonly NarratedSlideInput[];
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

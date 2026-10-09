import type { NarrationSection } from "../narration/NarrationSections.js";
import type { SlideIndex } from "../slides/slideCoordinates.js";

export type PreviewSpeakerChoice =
  | { kind: "effective" }
  | { kind: "default" }
  | { kind: "override"; speaker: string };

export type PreviewNarrationRequest = {
  /** The author's current slide-note sections, in the order narration positions follow. */
  sections: readonly NarrationSection[];
  slideIndex: SlideIndex;
  sectionIndex: number;
  text: string;
  speakerChoice: PreviewSpeakerChoice;
};

export type NarrationPreviewResult = {
  audio: Uint8Array;
  mediaType: string;
};

export type NarratedSlideInput = {
  slideIndex: SlideIndex;
  /** The author's structured sections, in the order narration positions follow. */
  sections: readonly NarrationSection[];
};

export type NarratedSlideSaveRequest = NarratedSlideInput & {
  filePath: string;
};

export type NarratedPresentationSaveRequest = {
  filePath: string;
  slides: readonly NarratedSlideInput[];
};

export type SaveAllRunPhase = "generating" | "saving";

/**
 * Where a save-all run stands. `completedSlides` and `totalSlides` count the
 * run's slides and are never a slide's identity, which `slideIndex` carries.
 */
export type SaveAllRunProgress = {
  slideIndex: SlideIndex;
  completedSlides: number;
  totalSlides: number;
  phase: SaveAllRunPhase;
};

export type NarratedSaveFailureStage = "validation" | "synthesis" | "powerpoint";

export type NarratedSaveResult =
  | { success: true }
  | {
      success: false;
      stage: NarratedSaveFailureStage;
      partial: boolean;
      message: string;
    };

export type SaveAllRunResult = {
  outcome: NarratedSaveResult;
  /** Submitted slides whose notes PowerPoint confirmed written, in run order. */
  savedNoteSlides: readonly SlideIndex[];
};

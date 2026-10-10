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

export type SaveAllRunChannels = {
  runId: number;
  progressChannel: string;
};

export type SaveAllRunPhase = "generating" | "saving";

export type SaveAllRunProgress = {
  slideIndex: SlideIndex;
  completedSlides: number;
  totalSlides: number;
  phase: SaveAllRunPhase;
};

export type SaveAllRunObserver = {
  onProgress: (progress: SaveAllRunProgress) => void;
  onCancellable: (cancel: () => void) => void;
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

export type SaveAllRunOutcome = NarratedSaveResult | { success: false; stage: "cancelled" };

export type SaveAllRunResult = {
  outcome: SaveAllRunOutcome;
  /** Submitted slides whose notes PowerPoint confirmed written, in run order. */
  savedNoteSlides: readonly SlideIndex[];
  failedSlideIndex?: SlideIndex;
};

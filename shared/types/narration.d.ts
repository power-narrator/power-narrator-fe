export interface PreviewNarrationRequest {
  slideIndex: number;
  sectionIndex: number;
  notes: string;
  text: string;
  previewSpeaker?: string;
}

export type PreviewNarrationResult = Uint8Array | null;

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

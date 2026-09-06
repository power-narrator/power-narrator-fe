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

export type NarratedSlideSaveFailureStage = "validation" | "synthesis" | "powerpoint";

export type NarratedSlideSaveResult =
  | { success: true }
  | {
      success: false;
      stage: NarratedSlideSaveFailureStage;
      partial: boolean;
      message: string;
    };

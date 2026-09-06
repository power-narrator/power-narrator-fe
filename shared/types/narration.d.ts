export interface PreviewNarrationRequest {
  slideIndex: number;
  sectionIndex: number;
  notes: string;
  text: string;
  previewSpeaker?: string;
}

export type PreviewNarrationResult = Uint8Array | null;

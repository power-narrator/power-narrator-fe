export interface NoteSection {
  speaker: string;
  text: string;
  format?: {
    separatorBefore?: string;
    speakerPrefix?: string;
    speakerSuffix?: string;
  };
}

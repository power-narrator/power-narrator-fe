import {
  formatNarrationSections,
  parseNarrationSections,
  type NarrationSection,
} from "./NarrationSections.js";

/**
 * Transitional shape: migrated callers send structured sections, callers still
 * awaiting migration send raw PowerPoint note text. The raw form disappears
 * once every workflow submits structured sections.
 */
export type SlideNotePayload =
  | { sections: NarrationSection[]; notes?: undefined }
  | { notes: string; sections?: undefined };

export const toNarrationSections = (
  payload: SlideNotePayload,
  knownSpeakers: Iterable<string>,
): NarrationSection[] =>
  payload.sections === undefined
    ? parseNarrationSections(payload.notes, knownSpeakers)
    : payload.sections;

export const toNotesText = (payload: SlideNotePayload): string =>
  payload.sections === undefined ? payload.notes : formatNarrationSections(payload.sections);

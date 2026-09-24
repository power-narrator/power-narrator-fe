import type { SectionId } from "./SlideNoteEditor";

/**
 * Only the editing session mints section identities. A view test needs no more
 * than distinct ones, so the cast that defeats the brand lives here alone.
 */
export const sectionIdentity = (name: string) => name as SectionId;

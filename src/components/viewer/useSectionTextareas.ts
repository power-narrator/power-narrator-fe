import { useCallback, useMemo, useRef } from "react";
import type { SectionId, SelectionIntent, TextRange } from "./SlideNoteEditor";

/**
 * The view's only contact with textarea DOM. It reads the plain selection
 * offsets the editor's commands take and applies the focus and selection the
 * editor asks for once an edit has rendered; no node crosses either way.
 */
export function useSectionTextareas() {
  const textareas = useRef(new Map<SectionId, HTMLTextAreaElement>());

  const assign = useCallback((id: SectionId, element: HTMLTextAreaElement | null) => {
    if (element) {
      textareas.current.set(id, element);
    } else {
      textareas.current.delete(id);
    }
  }, []);

  const selectionIn = useCallback((id: SectionId): TextRange | undefined => {
    const textarea = textareas.current.get(id);
    return textarea && { start: textarea.selectionStart, end: textarea.selectionEnd };
  }, []);

  /** The author's selection within the section, or all of its text when nothing is selected. */
  const selectedTextIn = useCallback((id: SectionId): string | undefined => {
    const textarea = textareas.current.get(id);
    if (!textarea) {
      return undefined;
    }

    return textarea.selectionStart === textarea.selectionEnd
      ? textarea.value
      : textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  }, []);

  const restore = useCallback((intent: SelectionIntent): boolean => {
    const textarea = textareas.current.get(intent.sectionId);
    if (!textarea) {
      return false;
    }

    textarea.focus();
    textarea.setSelectionRange(intent.start, intent.end);
    return true;
  }, []);

  return useMemo(
    () => ({ assign, selectionIn, selectedTextIn, restore }),
    [assign, selectionIn, selectedTextIn, restore],
  );
}

export type SectionTextareas = ReturnType<typeof useSectionTextareas>;

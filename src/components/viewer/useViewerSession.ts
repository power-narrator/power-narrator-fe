import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "../../types/electron";
import { ViewerSession, type SavedSlideSelection } from "./ViewerSession";

export function useViewerSession(
  initialSlides: Slide[],
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void,
) {
  const [session, setSession] = useState(() => ViewerSession.load(initialSlides));
  const onUnsavedChangesChangeRef = useRef(onUnsavedChangesChange);
  onUnsavedChangesChangeRef.current = onUnsavedChangesChange;

  const transition = useCallback((update: (current: ViewerSession) => ViewerSession) => {
    setSession((current) => {
      const next = update(current);
      onUnsavedChangesChangeRef.current(next.wouldDiscard());
      return next;
    });
  }, []);

  useEffect(() => {
    transition(() => ViewerSession.load(initialSlides));
  }, [initialSlides, transition]);

  useEffect(
    () => () => {
      onUnsavedChangesChangeRef.current(false);
    },
    [],
  );

  return {
    slides: session.slides,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    wouldDiscard: (slideIndices?: readonly number[]) => session.wouldDiscard(slideIndices),
    edit: (slides: Slide[], positions: readonly number[]) =>
      transition((current) => current.edit(slides, positions)),
    checkpoint: (slides: Slide[], positions: readonly number[]) =>
      transition((current) => current.edit(slides, positions).checkpoint(positions)),
    undo: () => transition((current) => current.undo()),
    redo: () => transition((current) => current.redo()),
    markSaved: (savedSlides: readonly SavedSlideSelection[]) =>
      transition((current) => current.markSaved(savedSlides)),
    reload: (slides: Slide[], positions?: readonly number[]) =>
      transition((current) => current.reload(slides, positions)),
  };
}

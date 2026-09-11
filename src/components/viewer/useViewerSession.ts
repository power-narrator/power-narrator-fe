import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Slide } from "../../types/electron";
import {
  loadViewerSession,
  reduceViewerSession,
  sessionWouldDiscard,
  type SavedSlideSelection,
} from "./ViewerSession";

export function useViewerSession(
  initialSlides: Slide[],
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void,
) {
  const [state, dispatch] = useReducer(reduceViewerSession, initialSlides, loadViewerSession);
  const reportUnsavedChangesRef = useRef(onUnsavedChangesChange);
  reportUnsavedChangesRef.current = onUnsavedChangesChange;
  const hasUnsavedChanges = state.dirtySlideIndices.size > 0;

  useEffect(() => {
    reportUnsavedChangesRef.current(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  useEffect(
    () => () => {
      reportUnsavedChangesRef.current(false);
    },
    [],
  );

  const wouldDiscard = useCallback(
    (slideIndices?: readonly number[]) => sessionWouldDiscard(state, slideIndices),
    [state],
  );

  return {
    slides: state.slides,
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex < state.history.length - 1,
    wouldDiscard,
    updateSlides: (slides: Slide[], changedSlidePositions: readonly number[]) =>
      dispatch({ type: "edit", slides, changedSlidePositions }),
    commitSlides: (slides: Slide[], changedSlidePositions: readonly number[]) =>
      dispatch({ type: "checkpoint", slides, changedSlidePositions }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    saveCompleted: (savedSlides: readonly SavedSlideSelection[]) =>
      dispatch({ type: "saved", savedSlides }),
    reloadCompleted: (slides: Slide[], reloadedSlidePositions?: readonly number[]) =>
      dispatch({ type: "reloaded", slides, reloadedSlidePositions }),
  };
}

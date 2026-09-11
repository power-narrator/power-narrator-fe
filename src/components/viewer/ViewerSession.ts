import type { Slide } from "../../types/electron";

interface SlideChange {
  slides: Slide[];
  changedSlidePositions: readonly number[];
}

type HistoryEntry = SlideChange;

export interface SavedSlideSelection {
  position: number;
  slide: Slide;
}

export interface ViewerSessionState {
  slides: Slide[];
  fullySavedNotes: ReadonlyMap<number, string>;
  dirtySlideIndices: ReadonlySet<number>;
  history: readonly HistoryEntry[];
  historyIndex: number;
}

export type ViewerSessionAction =
  | ({ type: "edit" } & SlideChange)
  | ({ type: "checkpoint" } & SlideChange)
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved"; savedSlides: readonly SavedSlideSelection[] }
  | { type: "reloaded"; slides: Slide[]; reloadedSlidePositions?: readonly number[] };

export function loadViewerSession(slides: Slide[]): ViewerSessionState {
  return {
    slides,
    fullySavedNotes: new Map(slides.map((slide) => [slide.index, slide.notes || ""])),
    dirtySlideIndices: new Set(),
    history: [{ slides, changedSlidePositions: [] }],
    historyIndex: 0,
  };
}

function withEditedSlides(
  state: ViewerSessionState,
  slides: Slide[],
  changedSlidePositions: readonly number[],
): ViewerSessionState {
  const dirtySlideIndices = new Set(state.dirtySlideIndices);
  for (const position of changedSlidePositions) {
    const slide = slides[position];
    if (!slide) continue;

    if (state.fullySavedNotes.get(slide.index) === (slide.notes || "")) {
      dirtySlideIndices.delete(slide.index);
    } else {
      dirtySlideIndices.add(slide.index);
    }
  }

  return { ...state, slides, dirtySlideIndices };
}

function moveThroughHistory(
  state: ViewerSessionState,
  historyIndex: number,
  changedSlidePositions: readonly number[],
) {
  return withEditedSlides(state, state.history[historyIndex]!.slides, changedSlidePositions);
}

export function reduceViewerSession(
  state: ViewerSessionState,
  action: ViewerSessionAction,
): ViewerSessionState {
  switch (action.type) {
    case "edit":
      return withEditedSlides(state, action.slides, action.changedSlidePositions);
    case "checkpoint": {
      const edited = withEditedSlides(state, action.slides, action.changedSlidePositions);
      const historyIndex = state.historyIndex + 1;
      return {
        ...edited,
        history: [
          ...state.history.slice(0, historyIndex),
          { slides: action.slides, changedSlidePositions: action.changedSlidePositions },
        ],
        historyIndex,
      };
    }
    case "undo": {
      if (state.historyIndex === 0) return state;
      const currentEntry = state.history[state.historyIndex]!;
      return {
        ...moveThroughHistory(state, state.historyIndex - 1, currentEntry.changedSlidePositions),
        historyIndex: state.historyIndex - 1,
      };
    }
    case "redo": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const historyIndex = state.historyIndex + 1;
      const nextEntry = state.history[historyIndex]!;
      return {
        ...moveThroughHistory(state, historyIndex, nextEntry.changedSlidePositions),
        historyIndex,
      };
    }
    case "saved": {
      const fullySavedNotes = new Map(state.fullySavedNotes);
      for (const { slide } of action.savedSlides) {
        fullySavedNotes.set(slide.index, slide.notes || "");
      }
      return withEditedSlides(
        { ...state, fullySavedNotes },
        state.slides,
        action.savedSlides.map(({ position }) => position),
      );
    }
    case "reloaded": {
      const positions =
        action.reloadedSlidePositions ?? action.slides.map((_, position) => position);
      const fullySavedNotes = new Map(state.fullySavedNotes);
      for (const position of positions) {
        const slide = action.slides[position];
        if (slide) fullySavedNotes.set(slide.index, slide.notes || "");
      }
      const reloaded: ViewerSessionState = {
        slides: action.slides,
        fullySavedNotes,
        dirtySlideIndices: action.reloadedSlidePositions ? state.dirtySlideIndices : new Set(),
        history: [{ slides: action.slides, changedSlidePositions: [] }],
        historyIndex: 0,
      };
      return withEditedSlides(reloaded, action.slides, positions);
    }
  }
}

export function sessionWouldDiscard(state: ViewerSessionState, slideIndices?: readonly number[]) {
  return slideIndices
    ? slideIndices.some((slideIndex) => state.dirtySlideIndices.has(slideIndex))
    : state.dirtySlideIndices.size > 0;
}

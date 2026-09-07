import type { Slide } from "../../types/electron";

interface HistoryEntry {
  slides: Slide[];
  changedSlidePositions: readonly number[];
}

export interface SavedSlideSelection {
  position: number;
  slide: Slide;
}

export class ViewerSession {
  private constructor(
    readonly slides: Slide[],
    private readonly fullySavedNotes: ReadonlyMap<number, string>,
    private readonly dirtySlideIndices: ReadonlySet<number>,
    private readonly history: readonly HistoryEntry[],
    private readonly historyIndex: number,
  ) {}

  static load(slides: Slide[]) {
    return new ViewerSession(
      slides,
      new Map(slides.map((slide) => [slide.index, slide.notes || ""])),
      new Set(),
      [{ slides, changedSlidePositions: [] }],
      0,
    );
  }

  get canUndo() {
    return this.historyIndex > 0;
  }

  get canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  edit(nextSlides: Slide[], changedSlidePositions: readonly number[]) {
    const dirtySlideIndices = new Set(this.dirtySlideIndices);
    for (const position of changedSlidePositions) {
      const slide = nextSlides[position];
      if (!slide) {
        continue;
      }

      if (this.fullySavedNotes.get(slide.index) === (slide.notes || "")) {
        dirtySlideIndices.delete(slide.index);
      } else {
        dirtySlideIndices.add(slide.index);
      }
    }

    return new ViewerSession(
      nextSlides,
      this.fullySavedNotes,
      dirtySlideIndices,
      this.history,
      this.historyIndex,
    );
  }

  checkpoint(changedSlidePositions: readonly number[]) {
    const nextHistoryIndex = this.historyIndex + 1;
    return new ViewerSession(
      this.slides,
      this.fullySavedNotes,
      this.dirtySlideIndices,
      [...this.history.slice(0, nextHistoryIndex), { slides: this.slides, changedSlidePositions }],
      nextHistoryIndex,
    );
  }

  undo() {
    if (this.historyIndex === 0) {
      return this;
    }

    const currentEntry = this.history[this.historyIndex]!;
    const nextHistoryIndex = this.historyIndex - 1;
    return this.moveThroughHistory(nextHistoryIndex, currentEntry.changedSlidePositions);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) {
      return this;
    }

    const nextHistoryIndex = this.historyIndex + 1;
    const nextEntry = this.history[nextHistoryIndex]!;
    return this.moveThroughHistory(nextHistoryIndex, nextEntry.changedSlidePositions);
  }

  markSaved(savedSlides: readonly SavedSlideSelection[]) {
    const fullySavedNotes = new Map(this.fullySavedNotes);
    for (const { slide } of savedSlides) {
      fullySavedNotes.set(slide.index, slide.notes || "");
    }

    const saved = new ViewerSession(
      this.slides,
      fullySavedNotes,
      this.dirtySlideIndices,
      this.history,
      this.historyIndex,
    );
    return saved.edit(
      saved.slides,
      savedSlides.map(({ position }) => position),
    );
  }

  reload(nextSlides: Slide[], reloadedSlidePositions?: readonly number[]) {
    const positions = reloadedSlidePositions ?? nextSlides.map((_, position) => position);
    const fullySavedNotes = new Map(this.fullySavedNotes);
    for (const position of positions) {
      const slide = nextSlides[position];
      if (slide) {
        fullySavedNotes.set(slide.index, slide.notes || "");
      }
    }

    const reloaded = new ViewerSession(
      nextSlides,
      fullySavedNotes,
      reloadedSlidePositions ? this.dirtySlideIndices : new Set(),
      [{ slides: nextSlides, changedSlidePositions: [] }],
      0,
    );
    return reloaded.edit(nextSlides, positions);
  }

  wouldDiscard(slideIndices?: readonly number[]) {
    return slideIndices
      ? slideIndices.some((slideIndex) => this.dirtySlideIndices.has(slideIndex))
      : this.dirtySlideIndices.size > 0;
  }

  private moveThroughHistory(historyIndex: number, changedSlidePositions: readonly number[]) {
    const history = this.history;
    const moved = new ViewerSession(
      history[historyIndex]!.slides,
      this.fullySavedNotes,
      this.dirtySlideIndices,
      history,
      historyIndex,
    );
    return moved.edit(moved.slides, changedSlidePositions);
  }
}

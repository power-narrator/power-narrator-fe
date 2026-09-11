import { describe, expect, it } from "vitest";
import type { Slide } from "../../types/electron";
import {
  loadViewerSession,
  reduceViewerSession,
  sessionWouldDiscard,
  type ViewerSessionState,
} from "./ViewerSession";

function slide(index: number, notes: string): Slide {
  return { index, image: `slide-${index}.png`, src: `slide-${index}`, notes };
}

const firstSlide = slide(1, "First narration");
const secondSlide = slide(2, "Second narration");

function loadedSession(): ViewerSessionState {
  return loadViewerSession([firstSlide, secondSlide]);
}

function editSlide(
  state: ViewerSessionState,
  type: "edit" | "checkpoint",
  position: number,
  notes: string,
): ViewerSessionState {
  const slides = state.slides.map((existing, index) =>
    index === position ? { ...existing, notes } : existing,
  );
  return reduceViewerSession(state, { type, slides, changedSlidePositions: [position] });
}

const edit = (state: ViewerSessionState, position: number, notes: string) =>
  editSlide(state, "edit", position, notes);

const checkpoint = (state: ViewerSessionState, position: number, notes: string) =>
  editSlide(state, "checkpoint", position, notes);

describe("reduceViewerSession", () => {
  it("marks an edited slide dirty", () => {
    const edited = edit(loadedSession(), 0, "Edited");

    expect([...edited.dirtySlideIndices]).toEqual([1]);
  });

  it("clears dirty state when an edit restores the saved notes", () => {
    const edited = edit(loadedSession(), 0, "Edited");

    expect([...edit(edited, 0, "First narration").dirtySlideIndices]).toEqual([]);
  });

  it("records a history entry on checkpoint", () => {
    const committed = checkpoint(loadedSession(), 0, "Committed");

    expect(committed.historyIndex).toBe(1);
    expect(committed.history).toHaveLength(2);
  });

  it("discards redone history when a checkpoint follows an undo", () => {
    const committed = checkpoint(checkpoint(loadedSession(), 0, "One"), 0, "Two");
    const undone = reduceViewerSession(committed, { type: "undo" });

    const rewritten = checkpoint(undone, 0, "Three");

    expect(rewritten.history).toHaveLength(3);
    expect(rewritten.historyIndex).toBe(2);
    expect(reduceViewerSession(rewritten, { type: "redo" })).toBe(rewritten);
  });

  it("restores the previous checkpoint on undo", () => {
    const committed = checkpoint(loadedSession(), 0, "Committed");

    const undone = reduceViewerSession(committed, { type: "undo" });

    expect(undone.slides[0]!.notes).toBe("First narration");
    expect([...undone.dirtySlideIndices]).toEqual([]);
  });

  it("keeps the loaded state when there is nothing to undo", () => {
    const session = loadedSession();

    expect(reduceViewerSession(session, { type: "undo" })).toBe(session);
  });

  it("restores the undone checkpoint on redo", () => {
    const committed = checkpoint(loadedSession(), 0, "Committed");
    const undone = reduceViewerSession(committed, { type: "undo" });

    const redone = reduceViewerSession(undone, { type: "redo" });

    expect(redone.slides[0]!.notes).toBe("Committed");
    expect([...redone.dirtySlideIndices]).toEqual([1]);
  });

  it("keeps the current state when there is nothing to redo", () => {
    const committed = checkpoint(loadedSession(), 0, "Committed");

    expect(reduceViewerSession(committed, { type: "redo" })).toBe(committed);
  });

  it("preserves edits to other slides across undo", () => {
    const committed = checkpoint(checkpoint(loadedSession(), 0, "Edited one"), 1, "Edited two");

    const undone = reduceViewerSession(committed, { type: "undo" });

    expect(undone.slides[0]!.notes).toBe("Edited one");
    expect(undone.slides[1]!.notes).toBe("Second narration");
  });

  it("clears dirty state only for the saved slides", () => {
    const committed = checkpoint(checkpoint(loadedSession(), 0, "Edited one"), 1, "Edited two");

    const saved = reduceViewerSession(committed, {
      type: "saved",
      savedSlides: [{ position: 0, slide: committed.slides[0]! }],
    });

    expect([...saved.dirtySlideIndices]).toEqual([2]);
  });

  it("keeps a slide dirty when it was edited after the notes that were saved", () => {
    const committed = checkpoint(loadedSession(), 0, "Sent for save");
    const sentSlide = committed.slides[0]!;
    const editedDuringSave = edit(committed, 0, "Edited while saving");

    const saved = reduceViewerSession(editedDuringSave, {
      type: "saved",
      savedSlides: [{ position: 0, slide: sentSlide }],
    });

    expect([...saved.dirtySlideIndices]).toEqual([1]);
  });

  it("replaces every slide and clears history when a full reload arrives", () => {
    const committed = checkpoint(loadedSession(), 0, "Edited one");
    const reloadedSlides = [slide(1, "Reloaded one"), slide(2, "Reloaded two")];

    const reloaded = reduceViewerSession(committed, {
      type: "reloaded",
      slides: reloadedSlides,
    });

    expect(reloaded.slides).toEqual(reloadedSlides);
    expect([...reloaded.dirtySlideIndices]).toEqual([]);
    expect(reloaded.history).toHaveLength(1);
    expect(reloaded.historyIndex).toBe(0);
  });

  it("keeps other slides dirty when only some positions were reloaded", () => {
    const committed = checkpoint(checkpoint(loadedSession(), 0, "Edited one"), 1, "Edited two");
    const reloadedSlides = [slide(1, "Reloaded one"), committed.slides[1]!];

    const reloaded = reduceViewerSession(committed, {
      type: "reloaded",
      slides: reloadedSlides,
      reloadedSlidePositions: [0],
    });

    expect(reloaded.slides[0]!.notes).toBe("Reloaded one");
    expect([...reloaded.dirtySlideIndices]).toEqual([2]);
  });
});

describe("sessionWouldDiscard", () => {
  it("reports no discard for a session without edits", () => {
    expect(sessionWouldDiscard(loadedSession())).toBe(false);
  });

  it("reports a discard when any slide is dirty", () => {
    expect(sessionWouldDiscard(edit(loadedSession(), 0, "Edited"))).toBe(true);
  });

  it("reports a discard only for the named dirty slides", () => {
    const edited = edit(loadedSession(), 0, "Edited");

    expect(sessionWouldDiscard(edited, [2])).toBe(false);
    expect(sessionWouldDiscard(edited, [1, 2])).toBe(true);
  });
});

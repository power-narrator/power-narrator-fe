import { expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import type { Slide } from "../../types/electron";
import { useViewerSession } from "./useViewerSession";

const loadedSlides: Slide[] = [
  { index: 1, image: "one.png", src: "one", notes: "Loaded one" },
  { index: 2, image: "two.png", src: "two", notes: "Loaded two" },
];

test("reports unsaved narration only while an edit differs from its loaded value", async () => {
  const onUnsavedChangesChange = vi.fn();
  const hook = await renderHook(() => useViewerSession(loadedSlides, onUnsavedChangesChange));
  onUnsavedChangesChange.mockClear();

  await hook.act(() => {
    hook.result.current.edit([{ ...loadedSlides[0]!, notes: "Edited" }, loadedSlides[1]!], [0]);
  });
  expect(hook.result.current.wouldDiscard()).toBe(true);
  expect(hook.result.current.wouldDiscard([2])).toBe(false);
  expect(onUnsavedChangesChange).toHaveBeenLastCalledWith(true);

  await hook.act(() => {
    hook.result.current.edit(loadedSlides, [0]);
  });
  expect(hook.result.current.wouldDiscard()).toBe(false);
  expect(onUnsavedChangesChange).toHaveBeenLastCalledWith(false);
});

test("undoes and redoes only the slides affected by each history transition", async () => {
  const hook = await renderHook(() => useViewerSession(loadedSlides, vi.fn()));
  const firstEdit = [{ ...loadedSlides[0]!, notes: "Edited one" }, loadedSlides[1]!];
  const secondEdit = [firstEdit[0]!, { ...loadedSlides[1]!, notes: "Edited two" }];

  await hook.act(() => hook.result.current.checkpoint(firstEdit, [0]));
  await hook.act(() => hook.result.current.checkpoint(secondEdit, [1]));
  await hook.act(() => hook.result.current.undo());

  expect(hook.result.current.slides.map((slide) => slide.notes)).toEqual([
    "Edited one",
    "Loaded two",
  ]);
  expect(hook.result.current.canRedo).toBe(true);

  await hook.act(() => hook.result.current.redo());
  expect(hook.result.current.slides.map((slide) => slide.notes)).toEqual([
    "Edited one",
    "Edited two",
  ]);
});

test("clears warnings only for narration that was saved or reloaded", async () => {
  const hook = await renderHook(() => useViewerSession(loadedSlides, vi.fn()));
  const editedSlides = loadedSlides.map((slide) => ({
    ...slide,
    notes: `Edited ${slide.index}`,
  }));

  await hook.act(() => hook.result.current.edit(editedSlides, [0, 1]));
  await hook.act(() => hook.result.current.markSaved([{ position: 0, slide: editedSlides[0]! }]));
  expect(hook.result.current.wouldDiscard([1])).toBe(false);
  expect(hook.result.current.wouldDiscard([2])).toBe(true);

  await hook.act(() =>
    hook.result.current.reload(
      [editedSlides[0]!, { ...loadedSlides[1]!, notes: "Reloaded two" }],
      [1],
    ),
  );
  expect(hook.result.current.wouldDiscard()).toBe(false);
});

test("keeps newer edits dirty when an older save finishes", async () => {
  const hook = await renderHook(() => useViewerSession(loadedSlides, vi.fn()));
  const sentForSave = { ...loadedSlides[0]!, notes: "Sent for save" };
  const editedWhileSaving = { ...sentForSave, notes: "Edited while saving" };

  await hook.act(() => hook.result.current.edit([sentForSave, loadedSlides[1]!], [0]));
  await hook.act(() => hook.result.current.edit([editedWhileSaving, loadedSlides[1]!], [0]));
  await hook.act(() => hook.result.current.markSaved([{ position: 0, slide: sentForSave }]));

  expect(hook.result.current.slides[0]!.notes).toBe("Edited while saving");
  expect(hook.result.current.wouldDiscard([1])).toBe(true);
});

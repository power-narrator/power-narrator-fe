import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  formatNarrationSections,
  parseNarrationSections,
} from "../../../shared/narration/NarrationSections";
import type {
  NarratedSaveResult,
  PreviewNarrationRequest,
  SaveAllRunResult,
} from "../../../shared/types/narration";
import { AudioProvider } from "../../context/AudioContext";
import { toSlideIndex, type SlideIndex } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import { SettingsProvider } from "../../context/SettingsContext";
import { ViewerPage } from "./ViewerPage";
import { NarrationPreviewProvider } from "./useNarrationPreview";

const at = (zeroBased: number): SlideIndex => toSlideIndex(zeroBased);

function loadedWith(notes: string, knownSpeakers: readonly string[] = []): Slide {
  return {
    slideIndex: at(0),
    image: "slide-one.png",
    src: "slide-one",
    sections: parseNarrationSections(notes, knownSpeakers).map((section) => ({
      ...section,
      playAcrossSlides: false,
    })),
  };
}

const loadedSlide = loadedWith("Loaded narration");

type ViewerElectronOverrides = {
  getSpeakerMappings?: typeof window.electronAPI.getSpeakerMappings;
  confirmDiscardNarrationChanges?: () => Promise<boolean>;
  reloadSlide?: typeof window.electronAPI.reloadSlide;
  saveNarratedSlide?: typeof window.electronAPI.saveNarratedSlide;
  saveNarratedPresentation?: typeof window.electronAPI.saveNarratedPresentation;
  getVideoSavePath?: typeof window.electronAPI.getVideoSavePath;
  generateVideo?: typeof window.electronAPI.generateVideo;
  playSlide?: typeof window.electronAPI.playSlide;
  removeAudio?: typeof window.electronAPI.removeAudio;
  convertPptx?: typeof window.electronAPI.convertPptx;
  prepareNarrationPreview?: typeof window.electronAPI.prepareNarrationPreview;
};

function installElectronApi(overrides: ViewerElectronOverrides = {}) {
  const electronAPI = {
    getSpeakerMappings: vi.fn<typeof window.electronAPI.getSpeakerMappings>(() =>
      Promise.resolve({}),
    ),
    setHasUnsavedNarrationChanges: vi.fn<typeof window.electronAPI.setHasUnsavedNarrationChanges>(),
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(false),
    ),
    reloadSlide: vi.fn<typeof window.electronAPI.reloadSlide>(() =>
      Promise.resolve({ success: true as const, slide: loadedSlide }),
    ),
    saveNarratedSlide: vi.fn<typeof window.electronAPI.saveNarratedSlide>(
      (): Promise<NarratedSaveResult> => Promise.resolve({ success: true }),
    ),
    saveNarratedPresentation: vi.fn<typeof window.electronAPI.saveNarratedPresentation>(
      (request): Promise<SaveAllRunResult> =>
        Promise.resolve({
          outcome: { success: true },
          savedNoteSlides: request.slides.map((slide) => slide.slideIndex),
        }),
    ),
    getVideoSavePath: vi.fn<typeof window.electronAPI.getVideoSavePath>(() =>
      Promise.resolve("video.mp4"),
    ),
    generateVideo: vi.fn<typeof window.electronAPI.generateVideo>(() =>
      Promise.resolve({ success: true as const, outputPath: "video.mp4" }),
    ),
    playSlide: vi.fn<typeof window.electronAPI.playSlide>(() =>
      Promise.resolve({ success: true as const }),
    ),
    removeAudio: vi.fn<typeof window.electronAPI.removeAudio>(() =>
      Promise.resolve({ success: true as const }),
    ),
    convertPptx: vi.fn<typeof window.electronAPI.convertPptx>(() =>
      Promise.resolve({ success: true as const, slides: [loadedSlide] }),
    ),
    prepareNarrationPreview: vi.fn<typeof window.electronAPI.prepareNarrationPreview>(() =>
      Promise.resolve({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" }),
    ),
    ...overrides,
  } as unknown as typeof window.electronAPI;

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: electronAPI,
  });
  return electronAPI;
}

async function renderViewer(onBack = vi.fn<() => void>(), slides: Slide[] = [loadedSlide]) {
  const screen = await render(
    <MantineProvider>
      <SettingsProvider>
        <AudioProvider>
          <NarrationPreviewProvider>
            <ViewerPage
              slides={slides}
              filePath="presentation.pptx"
              onBack={onBack}
              onOpenSettings={() => {}}
            />
          </NarrationPreviewProvider>
        </AudioProvider>
      </SettingsProvider>
    </MantineProvider>,
  );
  return { screen, onBack };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

test("renders the notes restored by undo/redo keyboard shortcuts", async () => {
  installElectronApi();
  // Installed before the render so the edit debounce is scheduled on the fake clock.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Edited narration");
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Undo" }).element()).not.toBeDisabled(),
  );

  editor
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Loaded narration"));

  editor
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Edited narration"));
});

test("wraps the selected narration in SSML and restores focus and selection", async () => {
  installElectronApi();
  const { screen } = await renderViewer();
  const notes = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });
  const textarea = notes.element() as HTMLTextAreaElement;

  textarea.focus();
  textarea.setSelectionRange(0, 6);
  await screen.getByRole("button", { name: "Paragraph" }).click();

  await expect.element(notes).toHaveValue("<p>Loaded</p> narration");
  expect(document.activeElement).toBe(textarea);
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 9]);
});

test("offers no slide actions when the presentation holds no slides", async () => {
  installElectronApi();
  const { screen } = await renderViewer(vi.fn<() => void>(), []);

  await expect.element(screen.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Save Slide", exact: true }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Reload Slide", exact: true }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Remove Audio", exact: true }))
    .toBeDisabled();
});

test("shows the sections of the slide whose thumbnail is chosen", async () => {
  installElectronApi();
  const secondSlide: Slide = {
    ...loadedWith("Second slide narration"),
    slideIndex: at(1),
    image: "slide-two.png",
  };
  const { screen } = await renderViewer(vi.fn(), [loadedSlide, secondSlide]);

  await screen.getByRole("button", { name: "Slide 2" }).click();

  await expect
    .element(screen.getByRole("textbox", { name: "Slide 2 section 1 notes" }))
    .toHaveValue("Second slide narration");
});

test("stays on the slide when the navigation discard warning is declined", async () => {
  installElectronApi({
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(false),
    ),
  });
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Unsaved narration");
  await screen.getByRole("button", { name: "Back", exact: false }).click();

  expect(onBack).not.toHaveBeenCalled();
});

test("keeps the edited narration when the reload discard warning is declined", async () => {
  installElectronApi({
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(false),
    ),
  });
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();

  expect(editor.element()).toHaveValue("Unsaved narration");
});

test("restores the loaded narration when the reload discard warning is accepted", async () => {
  installElectronApi({
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(true),
    ),
  });
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();

  await vi.waitFor(() => expect(editor.element()).toHaveValue("Loaded narration"));
});

test("clears the dirty warning after a successful narrated save", async () => {
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(() =>
    Promise.resolve({
      success: true,
    }),
  );
  installElectronApi({
    saveNarratedSlide,
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(false),
    ),
  });
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  await screen.getByRole("button", { name: "Back", exact: false }).click();

  expect(onBack).toHaveBeenCalledOnce();
});

test("disables conflicting Viewer operations while a save is active", async () => {
  let finishSave: ((result: NarratedSaveResult) => void) | undefined;
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(
    () => new Promise<NarratedSaveResult>((resolve) => (finishSave = resolve)),
  );
  installElectronApi({ saveNarratedSlide });
  const { screen } = await renderViewer();

  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Reload Slide", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove Audio", exact: true })).toBeDisabled();

  finishSave?.({ success: true });
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Reload Slide", exact: true })).not.toBeDisabled(),
  );
});

async function startSaveAll(screen: Awaited<ReturnType<typeof renderViewer>>["screen"]) {
  await screen.getByRole("button", { name: "Save All Slides", exact: true }).click();
  await screen.getByRole("button", { name: "Save All", exact: true }).click();
}

async function startGenerateVideo(screen: Awaited<ReturnType<typeof renderViewer>>["screen"]) {
  await screen.getByRole("button", { name: "Generate Video", exact: true }).click();
  await screen.getByRole("button", { name: "Save and Generate", exact: true }).click();
}

test("shows Cancelling... after Cancel and keeps unsaved edits once the run stops", async () => {
  let finishRun: ((result: SaveAllRunResult) => void) | undefined;
  const cancel = vi.fn<() => void>();
  const saveNarratedPresentation = vi.fn<typeof window.electronAPI.saveNarratedPresentation>(
    (_request, _onProgress, onCancellable) => {
      onCancellable?.(cancel);
      return new Promise<SaveAllRunResult>((resolve) => (finishRun = resolve));
    },
  );
  const confirmDiscardNarrationChanges = vi.fn<
    typeof window.electronAPI.confirmDiscardNarrationChanges
  >(() => Promise.resolve(false));
  installElectronApi({ saveNarratedPresentation, confirmDiscardNarrationChanges });
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await startSaveAll(screen);
  const progress = screen.getByRole("dialog", { name: "Saving all slides" });
  await progress.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect.element(progress.getByText("Cancelling...")).toBeVisible();
  await expect
    .element(progress.getByRole("button", { name: "Cancel", exact: true }))
    .toBeDisabled();
  expect(cancel).toHaveBeenCalledOnce();

  finishRun?.({ outcome: { success: false, stage: "cancelled" }, savedNoteSlides: [] });
  await expect.element(progress).not.toBeInTheDocument();
  expect(alert).not.toHaveBeenCalled();
  await expect
    .element(screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }))
    .toHaveValue("Edited narration");
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce();
  expect(onBack).not.toHaveBeenCalled();
});

test("alerts that a slide's notes saved without its audio and treats those notes as saved", async () => {
  const saveNarratedPresentation = vi.fn<typeof window.electronAPI.saveNarratedPresentation>(() =>
    Promise.resolve({
      outcome: { success: false, stage: "powerpoint", partial: true, message: "media rejected" },
      savedNoteSlides: [at(0)],
      failedSlideIndex: at(0),
    }),
  );
  installElectronApi({ saveNarratedPresentation });
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await startSaveAll(screen);

  await vi.waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      "Save error on slide 1: its notes were saved, but its narration audio was not fully saved, so the slide's notes and audio may not match. media rejected Later slides were not changed.",
    ),
  );
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(onBack).toHaveBeenCalledOnce();
});

test("does not generate video when the narrated save fails", async () => {
  const saveNarratedPresentation = vi.fn<typeof window.electronAPI.saveNarratedPresentation>(() =>
    Promise.resolve({
      outcome: {
        success: false,
        stage: "synthesis",
        partial: false,
        message: "Synthesis failed",
      },
      savedNoteSlides: [],
    }),
  );
  const generateVideo = vi.fn<typeof window.electronAPI.generateVideo>(() =>
    Promise.resolve({ success: true as const, outputPath: "video.mp4" }),
  );
  installElectronApi({ saveNarratedPresentation, generateVideo });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await startGenerateVideo(screen);
  await vi.waitFor(() => expect(saveNarratedPresentation).toHaveBeenCalledOnce());

  expect(generateVideo).not.toHaveBeenCalled();
});

test("generates video after a successful narrated save", async () => {
  const generateVideo = vi.fn<typeof window.electronAPI.generateVideo>(() =>
    Promise.resolve({ success: true as const, outputPath: "video.mp4" }),
  );
  installElectronApi({ generateVideo });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await startGenerateVideo(screen);

  await vi.waitFor(() => expect(generateVideo).toHaveBeenCalledOnce());
});

test("reports a slide playback failure", async () => {
  const playSlide = vi.fn<typeof window.electronAPI.playSlide>(() =>
    Promise.resolve({
      success: false,
      message: "PowerPoint is busy",
    }),
  );
  installElectronApi({ playSlide });
  const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen } = await renderViewer();

  await screen.getByRole("button", { name: "Play", exact: true }).click();

  await vi.waitFor(() =>
    expect(alertSpy).toHaveBeenCalledWith("Failed to play slide: PowerPoint is busy"),
  );
});

test("plays the active slide", async () => {
  const playSlide = vi.fn<typeof window.electronAPI.playSlide>(() =>
    Promise.resolve({ success: true }),
  );
  installElectronApi({ playSlide });
  const { screen } = await renderViewer();

  await screen.getByRole("button", { name: "Play", exact: true }).click();

  await vi.waitFor(() => expect(screen.getByText("Played").first()).toBeInTheDocument());
  expect(playSlide).toHaveBeenCalledWith({ filePath: "presentation.pptx", slideIndex: 0 });
});

test("removes audio for the active slide", async () => {
  const removeAudio = vi.fn<typeof window.electronAPI.removeAudio>(() =>
    Promise.resolve({ success: true }),
  );
  installElectronApi({ removeAudio });
  const { screen } = await renderViewer();

  await screen.getByRole("button", { name: "Remove Audio", exact: true }).click();

  await vi.waitFor(() => expect(screen.getByText("Removed!").first()).toBeInTheDocument());
  expect(removeAudio).toHaveBeenCalledWith({
    filePath: "presentation.pptx",
    slideIndices: [0],
  });
});

test("removes audio for every slide", async () => {
  const removeAudio = vi.fn<typeof window.electronAPI.removeAudio>(() =>
    Promise.resolve({ success: true }),
  );
  installElectronApi({ removeAudio });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const secondSlide: Slide = {
    ...loadedSlide,
    slideIndex: at(1),
    image: "slide-two.png",
  };
  const { screen } = await renderViewer(vi.fn<() => void>(), [loadedSlide, secondSlide]);

  await screen.getByRole("button", { name: "Remove All Audio", exact: true }).click();

  await vi.waitFor(() =>
    expect(removeAudio).toHaveBeenCalledWith({
      filePath: "presentation.pptx",
      slideIndices: [0, 1],
    }),
  );
});

test("keeps unsaved edits when the reload-all discard warning is declined", async () => {
  const convertPptx = vi.fn<typeof window.electronAPI.convertPptx>(() =>
    Promise.resolve({ success: true, slides: [loadedWith("Reloaded narration")] }),
  );
  installElectronApi({
    convertPptx,
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(false),
    ),
  });
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Reload All Slides", exact: true }).click();

  expect(editor.element()).toHaveValue("Unsaved narration");
});

test("reloads every slide when the reload-all discard warning is accepted", async () => {
  const convertPptx = vi.fn<typeof window.electronAPI.convertPptx>(() =>
    Promise.resolve({ success: true, slides: [loadedWith("Reloaded narration")] }),
  );
  installElectronApi({
    convertPptx,
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(true),
    ),
  });
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Reload All Slides", exact: true }).click();

  await vi.waitFor(() => expect(editor.element()).toHaveValue("Reloaded narration"));
});

const promptableVoice = {
  provider: "gcp",
  voiceId: "Achernar",
  model: "gemini-2.5-flash-tts",
  languageCode: "en-US",
  supportsPrompt: true,
};

function installPromptMappings(supportsPrompt = true, overrides: ViewerElectronOverrides = {}) {
  return installElectronApi({
    getSpeakerMappings: vi.fn<typeof window.electronAPI.getSpeakerMappings>(() =>
      Promise.resolve({ _default_: { voice: { ...promptableVoice, supportsPrompt } } }),
    ),
    ...overrides,
  });
}

const promptButton = "Prompt for slide 1 section 1";

test("shows the inline prompt a section already carries", async () => {
  installPromptMappings();
  const { screen } = await renderViewer(vi.fn(), [loadedWith("[p:excited]\nLoaded narration")]);

  await expect.element(screen.getByRole("textbox", { name: promptButton })).toHaveValue("excited");
});

test("removes the marker from the notes when the prompt is cleared", async () => {
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(() =>
    Promise.resolve({ success: true as const }),
  );
  installPromptMappings(true, { saveNarratedSlide });
  const { screen } = await renderViewer(vi.fn(), [loadedWith("[p:excited]\nLoaded narration")]);

  await screen.getByRole("textbox", { name: promptButton }).fill("");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();

  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  expect(formatNarrationSections(saveNarratedSlide.mock.lastCall![0].sections)).toBe(
    "Loaded narration",
  );
});

test("writes a marker into the notes when a prompt is added", async () => {
  const electronAPI = installPromptMappings();
  const { screen } = await renderViewer();

  await screen.getByRole("button", { name: promptButton }).click();
  await screen.getByRole("textbox", { name: promptButton }).fill("excited");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();

  await vi.waitFor(() =>
    expect(electronAPI.saveNarratedSlide).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [expect.objectContaining({ prompt: "excited", text: "Loaded narration" })],
      }),
    ),
  );
});

test("advises when the section's effective speaker ignores prompts", async () => {
  installPromptMappings(false);
  const { screen } = await renderViewer();

  await expect.element(screen.getByText("This model ignores prompts.")).toBeVisible();
});

function loadedWithPlayback(notes: string, playAcrossSlides: readonly boolean[]): Slide {
  const slide = loadedWith(notes);
  return {
    ...slide,
    sections: slide.sections.map((section, index) => ({
      ...section,
      playAcrossSlides: playAcrossSlides[index] ?? false,
    })),
  };
}

const playAcrossSlidesLabel = (sectionNumber: number) =>
  `Play across slides for slide 1 section ${sectionNumber}`;

test("shows whether each section's audio plays across slides, whatever its prompt support", async () => {
  installPromptMappings(false);
  const { screen } = await renderViewer(vi.fn(), [
    loadedWithPlayback("First narration\n---\nSecond narration", [true, false]),
  ]);

  await expect
    .element(screen.getByRole("checkbox", { name: playAcrossSlidesLabel(1) }))
    .toBeChecked();
  await expect
    .element(screen.getByRole("checkbox", { name: playAcrossSlidesLabel(2) }))
    .not.toBeChecked();
});

const submittedPlayback = (request: { sections: readonly { playAcrossSlides: boolean }[] }) =>
  request.sections.map((section) => section.playAcrossSlides);

test("saves the playback chosen for each section with Save Slide", async () => {
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(() =>
    Promise.resolve({ success: true }),
  );
  installElectronApi({ saveNarratedSlide });
  const { screen } = await renderViewer(vi.fn(), [
    loadedWithPlayback("First narration\n---\nSecond narration\n---\nThird narration", [
      true,
      false,
      true,
    ]),
  ]);

  await screen.getByRole("checkbox", { name: playAcrossSlidesLabel(1) }).click();
  await screen.getByRole("checkbox", { name: playAcrossSlidesLabel(2) }).click();
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();

  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  expect(submittedPlayback(saveNarratedSlide.mock.calls[0]![0])).toEqual([false, true, true]);
});

test("saves every slide's shown playback with Save All Slides, including untouched choices", async () => {
  const saveNarratedPresentation = vi.fn<typeof window.electronAPI.saveNarratedPresentation>(
    (request) =>
      Promise.resolve({
        outcome: { success: true },
        savedNoteSlides: request.slides.map((slide) => slide.slideIndex),
      }),
  );
  installElectronApi({ saveNarratedPresentation });
  const { screen } = await renderViewer(vi.fn(), [
    loadedWithPlayback("First narration\n---\nSecond narration", [true, false]),
    { ...loadedWithPlayback("Other narration", [false]), slideIndex: at(1) },
  ]);

  await screen.getByRole("checkbox", { name: playAcrossSlidesLabel(2) }).click();
  await screen.getByRole("button", { name: "Save All Slides", exact: true }).click();
  await screen.getByRole("button", { name: "Save All", exact: true }).click();

  await vi.waitFor(() => expect(saveNarratedPresentation).toHaveBeenCalledOnce());
  expect(saveNarratedPresentation.mock.calls[0]![0].slides.map(submittedPlayback)).toEqual([
    [true, true],
    [false],
  ]);
});

test("saves the shown playback until a reload imports PowerPoint's", async () => {
  let powerPointPlayback = [false];
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(() =>
    Promise.resolve({ success: true }),
  );
  installElectronApi({
    saveNarratedSlide,
    reloadSlide: vi.fn<typeof window.electronAPI.reloadSlide>(() =>
      Promise.resolve({
        success: true,
        slide: loadedWithPlayback("Loaded narration", powerPointPlayback),
      }),
    ),
  });
  const { screen } = await renderViewer(vi.fn(), [
    loadedWithPlayback("Loaded narration", powerPointPlayback),
  ]);
  const saveSlide = screen.getByRole("button", { name: "Save Slide", exact: true });

  powerPointPlayback = [true];
  await saveSlide.click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  expect(submittedPlayback(saveNarratedSlide.mock.calls[0]![0])).toEqual([false]);

  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();
  await expect
    .element(screen.getByRole("checkbox", { name: playAcrossSlidesLabel(1) }))
    .toBeChecked();
  await saveSlide.click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledTimes(2));
  expect(submittedPlayback(saveNarratedSlide.mock.calls[1]![0])).toEqual([true]);
});

test("keeps the shown playback when reloading the slide fails", async () => {
  const alerted = vi.spyOn(window, "alert").mockImplementation(() => {});
  installElectronApi({
    reloadSlide: vi.fn<typeof window.electronAPI.reloadSlide>(() =>
      Promise.resolve({
        success: false,
        message: "Slide 1 has more than one shape named ppt_audio_1.",
      }),
    ),
  });
  const { screen } = await renderViewer(vi.fn(), [loadedWithPlayback("Loaded narration", [true])]);

  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();

  await vi.waitFor(() =>
    expect(alerted).toHaveBeenCalledWith(
      "Sync slide error: Slide 1 has more than one shape named ppt_audio_1.",
    ),
  );
  await expect
    .element(screen.getByRole("checkbox", { name: playAcrossSlidesLabel(1) }))
    .toBeChecked();
});

/** Loaded before the mapping existed, so its bracketed line was narration text. */
const taggedSlide = loadedWith("[Alice]\nLoaded narration");

test("shows a bracketed line as the section's speaker once a mapping names it", async () => {
  installElectronApi({
    getSpeakerMappings: vi.fn<typeof window.electronAPI.getSpeakerMappings>(() =>
      Promise.resolve({ Alice: { voice: promptableVoice } }),
    ),
  });
  const { screen } = await renderViewer(vi.fn(), [taggedSlide]);

  await expect
    .element(screen.getByRole("combobox", { name: "Speaker for slide 1 section 1" }))
    .toHaveValue("Alice");
  await expect
    .element(screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }))
    .toHaveValue("Loaded narration");
});

test("addresses the selected slide by its own index, not its place in the list", async () => {
  // A deck whose second entry is slide 3, so a slide's address cannot be
  // mistaken for its position among the thumbnails, and it is named by that
  // address rather than by where it sits.
  const thirdSlide: Slide = {
    ...loadedSlide,
    slideIndex: at(2),
    image: "slide-three.png",
  };
  const playSlide = vi.fn<typeof window.electronAPI.playSlide>(() =>
    Promise.resolve({ success: true as const }),
  );
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(
    (): Promise<NarratedSaveResult> => Promise.resolve({ success: true }),
  );
  const removeAudio = vi.fn<typeof window.electronAPI.removeAudio>(() =>
    Promise.resolve({ success: true as const }),
  );
  installElectronApi({ playSlide, saveNarratedSlide, removeAudio });
  const { screen } = await renderViewer(vi.fn<() => void>(), [loadedSlide, thirdSlide]);

  await screen.getByRole("button", { name: "Slide 3" }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Slide 3 section 1 notes" }))
    .toBeInTheDocument();
  await screen.getByRole("button", { name: "Play", exact: true }).click();

  await vi.waitFor(() =>
    expect(playSlide).toHaveBeenCalledWith({ filePath: "presentation.pptx", slideIndex: 2 }),
  );

  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();

  await vi.waitFor(() =>
    expect(saveNarratedSlide).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "presentation.pptx", slideIndex: 2 }),
    ),
  );

  await screen.getByRole("button", { name: "Remove All Audio", exact: true }).click();

  await vi.waitFor(() =>
    expect(removeAudio).toHaveBeenCalledWith({
      filePath: "presentation.pptx",
      slideIndices: [0, 2],
    }),
  );
});

test("previews the section with plain sections and its position in their order", async () => {
  const requests: PreviewNarrationRequest[] = [];
  installElectronApi({
    prepareNarrationPreview: (request) => {
      requests.push(request);
      return Promise.resolve({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const { screen } = await renderViewer(vi.fn<() => void>(), [
    loadedWith("First narration\n---\nSecond section"),
  ]);

  await screen.getByRole("button", { name: "Preview effective speaker" }).nth(1).click();

  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const [request] = requests;
  expect(request?.sectionIndex).toBe(1);
  expect(request?.sections).toEqual([
    { speaker: "", text: "First narration", playAcrossSlides: false },
    {
      speaker: "",
      text: "Second section",
      playAcrossSlides: false,
      format: { separatorBefore: "\n---\n" },
    },
  ]);
  expect(request?.sections.some((section) => "id" in section)).toBe(false);
});

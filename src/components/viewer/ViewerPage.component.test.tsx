import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { NarratedSaveResult } from "../../../shared/types/narration";
import { AudioProvider } from "../../context/AudioContext";
import type { Slide } from "../../types/electron";
import { SettingsProvider } from "../../context/SettingsContext";
import { ViewerPage } from "./ViewerPage";
import { NarrationPreviewProvider } from "./useNarrationPreview";

const loadedSlide: Slide = {
  index: 1,
  image: "slide-one.png",
  src: "slide-one",
  notes: "Loaded narration",
};

interface ViewerElectronOverrides {
  getSpeakerMappings?: typeof window.electronAPI.getSpeakerMappings;
  confirmDiscardNarrationChanges?: () => Promise<boolean>;
  reloadSlide?: typeof window.electronAPI.reloadSlide;
  saveNarratedSlide?: typeof window.electronAPI.saveNarratedSlide;
  saveNarratedPresentation?: typeof window.electronAPI.saveNarratedPresentation;
  saveNotes?: typeof window.electronAPI.saveNotes;
  getVideoSavePath?: typeof window.electronAPI.getVideoSavePath;
  generateVideo?: typeof window.electronAPI.generateVideo;
  playSlide?: typeof window.electronAPI.playSlide;
  removeAudio?: typeof window.electronAPI.removeAudio;
  convertPptx?: typeof window.electronAPI.convertPptx;
}

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
      (): Promise<NarratedSaveResult> => Promise.resolve({ success: true }),
    ),
    saveNotes: vi.fn<typeof window.electronAPI.saveNotes>(() =>
      Promise.resolve({ success: true as const }),
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

test("navigates back without a warning once a reload has discarded the edits", async () => {
  const discardDialog = { allow: true };
  installElectronApi({
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(discardDialog.allow),
    ),
  });
  const { screen, onBack } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Loaded narration"));

  // A declining dialog from here on: navigating back proves no warning was raised.
  discardDialog.allow = false;
  await screen.getByRole("button", { name: "Back", exact: false }).click();

  expect(onBack).toHaveBeenCalledOnce();
});

test("keeps narration dirty when the narrated save fails", async () => {
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(() =>
    Promise.resolve({
      success: false,
      stage: "validation",
      partial: false,
      message: "Invalid narration",
    }),
  );
  installElectronApi({
    saveNarratedSlide,
    confirmDiscardNarrationChanges: vi.fn<typeof window.electronAPI.confirmDiscardNarrationChanges>(
      () => Promise.resolve(false),
    ),
  });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  await screen.getByRole("button", { name: "Back", exact: false }).click();

  expect(onBack).not.toHaveBeenCalled();
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

test("keeps narration edited during a save dirty after that save completes", async () => {
  let finishSave: ((result: NarratedSaveResult) => void) | undefined;
  const saveNarratedSlide = vi.fn<typeof window.electronAPI.saveNarratedSlide>(
    () => new Promise<NarratedSaveResult>((resolve) => (finishSave = resolve)),
  );
  const confirmDiscardNarrationChanges = vi.fn<
    typeof window.electronAPI.confirmDiscardNarrationChanges
  >(() => Promise.resolve(false));
  installElectronApi({ saveNarratedSlide, confirmDiscardNarrationChanges });
  const { screen, onBack } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Sent for save");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledOnce());
  await editor.fill("Edited while saving");
  finishSave?.({ success: true });
  await vi.waitFor(() => expect(screen.getByText("Saved slides!").first()).toBeInTheDocument());

  await screen.getByRole("button", { name: "Back", exact: false }).click();

  expect(onBack).not.toHaveBeenCalled();
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

test("does not generate video when the narrated save fails", async () => {
  const saveNarratedPresentation = vi.fn<typeof window.electronAPI.saveNarratedPresentation>(() =>
    Promise.resolve({
      success: false,
      stage: "synthesis",
      partial: false,
      message: "Synthesis failed",
    }),
  );
  const generateVideo = vi.fn<typeof window.electronAPI.generateVideo>(() =>
    Promise.resolve({ success: true as const, outputPath: "video.mp4" }),
  );
  installElectronApi({ saveNarratedPresentation, generateVideo });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await screen.getByRole("button", { name: "Generate Video", exact: true }).click();
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
  await screen.getByRole("button", { name: "Generate Video", exact: true }).click();

  await vi.waitFor(() => expect(generateVideo).toHaveBeenCalledOnce());
});

test("commits notes through the narrated save rather than separately", async () => {
  const generateVideo = vi.fn<typeof window.electronAPI.generateVideo>(() =>
    Promise.resolve({ success: true as const, outputPath: "video.mp4" }),
  );
  const saveNotes = vi.fn<typeof window.electronAPI.saveNotes>(() =>
    Promise.resolve({ success: true as const }),
  );
  installElectronApi({ generateVideo, saveNotes });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await screen.getByRole("button", { name: "Generate Video", exact: true }).click();
  await vi.waitFor(() => expect(generateVideo).toHaveBeenCalledOnce());

  expect(saveNotes).not.toHaveBeenCalled();
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
  expect(playSlide).toHaveBeenCalledWith({ filePath: "presentation.pptx", slideIndex: 1 });
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
    slideIndices: [1],
  });
});

test("removes audio for every slide", async () => {
  const removeAudio = vi.fn<typeof window.electronAPI.removeAudio>(() =>
    Promise.resolve({ success: true }),
  );
  installElectronApi({ removeAudio });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const secondSlide: Slide = { ...loadedSlide, index: 2, image: "slide-two.png" };
  const { screen } = await renderViewer(vi.fn<() => void>(), [loadedSlide, secondSlide]);

  await screen.getByRole("button", { name: "Remove All Audio", exact: true }).click();

  await vi.waitFor(() =>
    expect(removeAudio).toHaveBeenCalledWith({
      filePath: "presentation.pptx",
      slideIndices: [1, 2],
    }),
  );
});

test("keeps unsaved edits when the reload-all discard warning is declined", async () => {
  const convertPptx = vi.fn<typeof window.electronAPI.convertPptx>(() =>
    Promise.resolve({
      success: true,
      slides: [{ ...loadedSlide, notes: "Reloaded narration" }],
    }),
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
    Promise.resolve({
      success: true,
      slides: [{ ...loadedSlide, notes: "Reloaded narration" }],
    }),
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

function installPromptMappings(supportsPrompt = true) {
  return installElectronApi({
    getSpeakerMappings: vi.fn<typeof window.electronAPI.getSpeakerMappings>(() =>
      Promise.resolve({ _default_: { voice: { ...promptableVoice, supportsPrompt } } }),
    ),
  });
}

const promptButton = "Prompt for slide 1 section 1";

test("shows the inline prompt a section already carries", async () => {
  installPromptMappings();
  const { screen } = await renderViewer(vi.fn(), [
    { ...loadedSlide, notes: "[p:excited]\nLoaded narration" },
  ]);

  await expect.element(screen.getByRole("textbox", { name: promptButton })).toHaveValue("excited");
});

test("removes the marker from the notes when the prompt is cleared", async () => {
  const electronAPI = installPromptMappings();
  const { screen } = await renderViewer(vi.fn(), [
    { ...loadedSlide, notes: "[p:excited]\nLoaded narration" },
  ]);

  await screen.getByRole("textbox", { name: promptButton }).fill("");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();

  await vi.waitFor(() =>
    expect(electronAPI.saveNarratedSlide).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Loaded narration" }),
    ),
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
      expect.objectContaining({ notes: "[prompt:excited]\nLoaded narration" }),
    ),
  );
});

test("advises when the section's effective speaker ignores prompts", async () => {
  installPromptMappings(false);
  const { screen } = await renderViewer();

  await expect.element(screen.getByText("This model ignores prompts.")).toBeVisible();
});

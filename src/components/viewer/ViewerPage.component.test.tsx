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
    getSpeakerMappings: vi.fn(async () => ({})),
    setHasUnsavedNarrationChanges: vi.fn(),
    confirmDiscardNarrationChanges: vi.fn(async () => false),
    reloadSlide: vi.fn(async () => ({ success: true as const, slide: loadedSlide })),
    saveNarratedSlide: vi.fn(async (): Promise<NarratedSaveResult> => ({ success: true })),
    saveNarratedPresentation: vi.fn(async (): Promise<NarratedSaveResult> => ({ success: true })),
    saveNotes: vi.fn(async () => ({ success: true as const })),
    getVideoSavePath: vi.fn(async () => "video.mp4"),
    generateVideo: vi.fn(async () => ({ success: true as const, outputPath: "video.mp4" })),
    playSlide: vi.fn(async () => ({ success: true as const })),
    removeAudio: vi.fn(async () => ({ success: true as const })),
    convertPptx: vi.fn(async () => ({ success: true as const, slides: [loadedSlide] })),
    ...overrides,
  } as unknown as typeof window.electronAPI;

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: electronAPI,
  });
  return electronAPI;
}

async function renderViewer(onBack = vi.fn(), slides: Slide[] = [loadedSlide]) {
  const screen = await render(
    <MantineProvider>
      <SettingsProvider>
        <AudioProvider>
          <NarrationPreviewProvider>
            <ViewerPage
              slides={slides}
              filePath="presentation.pptx"
              onBack={onBack}
              onOpenSettings={() => undefined}
            />
          </NarrationPreviewProvider>
        </AudioProvider>
      </SettingsProvider>
    </MantineProvider>,
  );
  return { screen, onBack };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders the notes restored by undo/redo keyboard shortcuts", async () => {
  installElectronApi();
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Edited narration");
  await new Promise((resolve) => window.setTimeout(resolve, 850));

  editor
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Loaded narration"));

  editor
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Edited narration"));
});

test("confirms before navigation and reload, then clears the warning after reload", async () => {
  let allowDiscard = false;
  const confirmDiscardNarrationChanges = vi.fn(async () => allowDiscard);
  const reloadSlide = vi.fn(async () => ({ success: true as const, slide: loadedSlide }));
  installElectronApi({ confirmDiscardNarrationChanges, reloadSlide });
  const { screen, onBack } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledTimes(1);
  expect(onBack).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledTimes(2);
  expect(reloadSlide).not.toHaveBeenCalled();

  allowDiscard = true;
  await screen.getByRole("button", { name: "Reload Slide", exact: true }).click();
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Loaded narration"));

  allowDiscard = false;
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledTimes(3);
  expect(onBack).toHaveBeenCalledOnce();
});

test("clears dirty state only after a successful narrated save", async () => {
  const confirmDiscardNarrationChanges = vi.fn(async () => false);
  const saveNarratedSlide = vi
    .fn<typeof window.electronAPI.saveNarratedSlide>()
    .mockResolvedValueOnce({
      success: false,
      stage: "validation",
      partial: false,
      message: "Invalid narration",
    })
    .mockResolvedValueOnce({ success: true });
  installElectronApi({ confirmDiscardNarrationChanges, saveNarratedSlide });
  vi.spyOn(window, "alert").mockImplementation(() => undefined);
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledTimes(1));
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce();
  expect(onBack).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Save Slide", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedSlide).toHaveBeenCalledTimes(2));
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce();
  expect(onBack).toHaveBeenCalledOnce();
});

test("keeps narration edited during a save dirty after that save completes", async () => {
  let finishSave: ((result: NarratedSaveResult) => void) | undefined;
  const saveNarratedSlide = vi.fn(
    () => new Promise<NarratedSaveResult>((resolve) => (finishSave = resolve)),
  );
  const confirmDiscardNarrationChanges = vi.fn(async () => false);
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
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce();
  expect(onBack).not.toHaveBeenCalled();
});

test("allows only the active Viewer operation to report progress", async () => {
  let finishSave: ((result: NarratedSaveResult) => void) | undefined;
  const saveNarratedSlide = vi.fn(
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

test("generates video only after narration and notes are committed together", async () => {
  const saveNarratedPresentation = vi
    .fn<typeof window.electronAPI.saveNarratedPresentation>()
    .mockResolvedValueOnce({
      success: false,
      stage: "synthesis",
      partial: false,
      message: "Synthesis failed",
    })
    .mockResolvedValueOnce({ success: true });
  const confirmDiscardNarrationChanges = vi.fn(async () => false);
  const generateVideo = vi.fn(async () => ({ success: true as const, outputPath: "video.mp4" }));
  const saveNotes = vi.fn(async () => ({ success: true as const }));
  const electronAPI = installElectronApi({
    saveNarratedPresentation,
    confirmDiscardNarrationChanges,
    generateVideo,
    saveNotes,
  });
  vi.spyOn(window, "alert").mockImplementation(() => undefined);
  const { screen, onBack } = await renderViewer();

  await screen.getByRole("textbox", { name: "Slide 1 section 1 notes" }).fill("Edited narration");
  await screen.getByRole("button", { name: "Generate Video", exact: true }).click();
  await vi.waitFor(() => expect(saveNarratedPresentation).toHaveBeenCalledTimes(1));
  expect(generateVideo).not.toHaveBeenCalled();
  expect(electronAPI.getVideoSavePath).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce();
  expect(onBack).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Generate Video", exact: true }).click();
  await vi.waitFor(() => expect(generateVideo).toHaveBeenCalledOnce());
  expect(saveNotes).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Back", exact: false }).click();
  expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce();
  expect(onBack).toHaveBeenCalledOnce();
});

test("plays the active slide and reports playback failures", async () => {
  const playSlide = vi
    .fn<typeof window.electronAPI.playSlide>()
    .mockResolvedValueOnce({ success: false, message: "PowerPoint is busy" })
    .mockResolvedValueOnce({ success: true });
  installElectronApi({ playSlide });
  const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
  const { screen } = await renderViewer();

  await screen.getByRole("button", { name: "Play", exact: true }).click();
  await vi.waitFor(() =>
    expect(alertSpy).toHaveBeenCalledWith("Failed to play slide: PowerPoint is busy"),
  );
  expect(playSlide).toHaveBeenCalledWith({ filePath: "presentation.pptx", slideIndex: 1 });

  await screen.getByRole("button", { name: "Play", exact: true }).click();
  await vi.waitFor(() => expect(screen.getByText("Played").first()).toBeInTheDocument());
});

test("removes audio for the active slide and for every slide", async () => {
  const removeAudio = vi.fn<typeof window.electronAPI.removeAudio>(async () => ({ success: true }));
  installElectronApi({ removeAudio });
  vi.spyOn(window, "alert").mockImplementation(() => undefined);
  const secondSlide: Slide = { ...loadedSlide, index: 2, image: "slide-two.png" };
  const { screen } = await renderViewer(vi.fn(), [loadedSlide, secondSlide]);

  await screen.getByRole("button", { name: "Remove Audio", exact: true }).click();
  await vi.waitFor(() => expect(screen.getByText("Removed!").first()).toBeInTheDocument());
  expect(removeAudio).toHaveBeenCalledWith({
    filePath: "presentation.pptx",
    slideIndices: [1],
  });

  await screen.getByRole("button", { name: "Remove All Audio", exact: true }).click();
  await vi.waitFor(() => expect(removeAudio).toHaveBeenCalledTimes(2));
  expect(removeAudio).toHaveBeenLastCalledWith({
    filePath: "presentation.pptx",
    slideIndices: [1, 2],
  });
});

test("reloads every slide only after unsaved edits are discarded", async () => {
  let allowDiscard = false;
  const confirmDiscardNarrationChanges = vi.fn(async () => allowDiscard);
  const convertPptx = vi.fn<typeof window.electronAPI.convertPptx>(async () => ({
    success: true,
    slides: [{ ...loadedSlide, notes: "Reloaded narration" }],
  }));
  installElectronApi({ confirmDiscardNarrationChanges, convertPptx });
  const { screen } = await renderViewer();
  const editor = screen.getByRole("textbox", { name: "Slide 1 section 1 notes" });

  await editor.fill("Unsaved narration");
  await screen.getByRole("button", { name: "Reload All Slides", exact: true }).click();
  await vi.waitFor(() => expect(confirmDiscardNarrationChanges).toHaveBeenCalledOnce());
  expect(convertPptx).not.toHaveBeenCalled();

  allowDiscard = true;
  await screen.getByRole("button", { name: "Reload All Slides", exact: true }).click();
  await vi.waitFor(() => expect(editor.element()).toHaveValue("Reloaded narration"));
  expect(convertPptx).toHaveBeenCalledWith("presentation.pptx");
});

import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { NarratedSaveResult } from "../../../shared/types/narration";
import { AudioProvider } from "../../context/AudioContext";
import type { Slide } from "../../types/electron";
import { SettingsProvider } from "../../context/SettingsContext";
import { ViewerPage } from "./ViewerPage";

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
}

function installElectronApi(overrides: ViewerElectronOverrides = {}) {
  const electronAPI = {
    getSpeakerMappings: vi.fn(async () => ({})),
    setHasUnsavedNarrationChanges: vi.fn(),
    confirmDiscardNarrationChanges: vi.fn(async () => false),
    reloadSlide: vi.fn(async () => ({ success: true as const, slide: loadedSlide })),
    saveNarratedSlide: vi.fn(async (): Promise<NarratedSaveResult> => ({ success: true })),
    ...overrides,
  } as unknown as typeof window.electronAPI;

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: electronAPI,
  });
  return electronAPI;
}

async function renderViewer(onBack = vi.fn()) {
  const screen = await render(
    <MantineProvider>
      <SettingsProvider>
        <AudioProvider>
          <ViewerPage
            slides={[loadedSlide]}
            filePath="presentation.pptx"
            onBack={onBack}
            onOpenSettings={() => undefined}
          />
        </AudioProvider>
      </SettingsProvider>
    </MantineProvider>,
  );
  return { screen, onBack };
}

afterEach(() => {
  vi.restoreAllMocks();
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

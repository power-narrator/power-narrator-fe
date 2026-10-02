import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { Slide } from "./types/electron";
import App from "./App";

vi.mock("./components/settings/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("./components/viewer/ViewerPage", () => ({
  ViewerPage: ({
    filePath,
    slides,
    onBack,
  }: {
    filePath: string;
    slides: Slide[];
    onBack: () => void;
  }) => (
    <>
      <span>{`${filePath}: ${slides.length} slides`}</span>
      <button onClick={onBack}>Back</button>
    </>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

function installApi(
  selectFile: () => Promise<string | null>,
  convertPptx: (
    filePath: string,
  ) => Promise<{ success: true; slides: Slide[] } | { success: false; message: string }>,
) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { selectFile, convertPptx },
  });
}

function renderApp() {
  return render(
    <MantineProvider>
      <App />
    </MantineProvider>,
  );
}

test("moves from file selection through loading to a viewer and back", async () => {
  let finishConversion: ((result: { success: true; slides: Slide[] }) => void) | undefined;
  installApi(
    () => Promise.resolve("presentation.pptx"),
    () =>
      new Promise((resolve) => {
        finishConversion = resolve;
      }),
  );
  const screen = await renderApp();

  await screen.getByRole("button", { name: "Select PowerPoint File" }).click();
  await expect.element(screen.getByText("Processing...")).toBeVisible();

  finishConversion?.({ success: true, slides: [] });
  await expect.element(screen.getByText("presentation.pptx: 0 slides")).toBeVisible();
  await screen.getByRole("button", { name: "Back" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Select PowerPoint File" }))
    .toBeVisible();
});

test("shows a conversion error and returns to file selection", async () => {
  installApi(
    () => Promise.resolve("broken.pptx"),
    () => Promise.resolve({ success: false, message: "Cannot read slides" }),
  );
  const screen = await renderApp();

  await screen.getByRole("button", { name: "Select PowerPoint File" }).click();
  await expect.element(screen.getByText("Error: Cannot read slides")).toBeVisible();
  await screen.getByRole("button", { name: "Try Again" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Select PowerPoint File" }))
    .toBeVisible();
});

import fs from "fs";
import os from "os";
import path from "path";
import { app } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MacPptProvider } from "./MacPptProvider.js";

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

type RunAppleScriptJson = (
  scriptName: string,
  args: string[],
) => Promise<{ success: true; data: { image: string } } | { success: false; message: string }>;

let tempDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-mac-provider-"));
  vi.mocked(app.getPath).mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("MacPptProvider.reloadSlideImage", () => {
  it("passes the requested 1-based slide index to the image export script", async () => {
    const provider = new MacPptProvider();
    const runAppleScriptJson = vi
      .spyOn(
        provider as unknown as { runAppleScriptJson: RunAppleScriptJson },
        "runAppleScriptJson",
      )
      .mockResolvedValue({
        success: true,
        data: { image: "slides/Slide_7_uuid.png" },
      });
    if (!tempDir) {
      throw new Error("Expected a temporary test directory");
    }
    const outputDir = path.join(tempDir, "deck");

    const result = await provider.reloadSlideImage("/presentations/deck.pptx", 7, outputDir);

    expect(runAppleScriptJson).toHaveBeenCalledWith("export-slide-images.applescript", [
      "/presentations/deck.pptx",
      outputDir,
      "7",
    ]);
    expect(result).toEqual({ success: true, image: "slides/Slide_7_uuid.png" });
  });
});

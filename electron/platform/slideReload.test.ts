import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSlideReload } from "./slideReload.js";
import type { ReadSlideNotesResult } from "./types.js";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

const tempDirs: string[] = [];

function createOutputDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-slide-reload-"));
  tempDirs.push(tempDir);

  const outputDir = path.join(tempDir, "deck");
  fs.mkdirSync(path.join(outputDir, "slides"), { recursive: true });
  return outputDir;
}

function writeFixture(outputDir: string, relativePath: string): string {
  const filePath = path.resolve(outputDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "fixture");
  return filePath;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("completeSlideReload", () => {
  it.each([
    [
      "returns an error",
      () => Promise.resolve({ success: false as const, message: "Notes failed" }),
      "Notes failed",
      false,
    ],
    ["throws", () => Promise.reject(new Error("Notes crashed")), "Notes crashed", true],
  ])(
    "rolls back the staged image when loading notes %s",
    async (_, loadNotesImplementation, expectedMessage, shouldLog) => {
      const outputDir = createOutputDir();
      const previousImage = writeFixture(outputDir, "slides/Slide_2_previous.png");
      const stagedImage = "slides/Slide_2_staged.png";
      const stagedImagePath = writeFixture(outputDir, stagedImage);
      const loadNotes = vi.fn(loadNotesImplementation);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await completeSlideReload(outputDir, 2, stagedImage, loadNotes);

      expect(result).toEqual({ success: false, message: expectedMessage });
      expect(loadNotes).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledTimes(shouldLog ? 1 : 0);
      expect(fs.existsSync(stagedImagePath)).toBe(false);
      expect(fs.existsSync(previousImage)).toBe(true);
    },
  );

  it.each([
    ["missing", "slides/Slide_2_missing.png", false],
    ["wrong-index", "slides/Slide_3_staged.png", true],
    ["nested", "slides/nested/Slide_2_staged.png", true],
    ["outside", "../outside.png", true],
  ])(
    "rejects a %s staged image without touching existing files",
    async (_, stagedImage, createStagedImage) => {
      const outputDir = createOutputDir();
      const previousImage = writeFixture(outputDir, "slides/Slide_2_previous.png");
      const stagedImagePath = createStagedImage ? writeFixture(outputDir, stagedImage) : null;
      const loadNotes = vi.fn<() => Promise<ReadSlideNotesResult>>();

      const result = await completeSlideReload(outputDir, 2, stagedImage, loadNotes);

      expect(result).toEqual({
        success: false,
        message: "The exported slide image is not available.",
      });
      expect(loadNotes).not.toHaveBeenCalled();
      expect(fs.existsSync(previousImage)).toBe(true);
      if (stagedImagePath) {
        expect(fs.existsSync(stagedImagePath)).toBe(true);
      }
    },
  );
});

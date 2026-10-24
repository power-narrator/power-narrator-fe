import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { completeSlideReload } from "./slideReload.js";

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

const content = { notes: "Fresh", sectionsPlayingAcrossSlides: new Set<number>() };

describe("completeSlideReload", () => {
  it.each([
    ["missing", "slides/Slide_2_missing.png", false],
    ["wrong-index", "slides/Slide_3_staged.png", true],
    ["nested", "slides/nested/Slide_2_staged.png", true],
    ["outside", "../outside.png", true],
  ])(
    "accepts the content without a preview for a %s staged image, leaving other slides' files alone",
    (_, stagedImage, createStagedImage) => {
      const outputDir = createOutputDir();
      const previousImage = writeFixture(outputDir, "slides/Slide_2_previous.png");
      const stagedImagePath = createStagedImage ? writeFixture(outputDir, stagedImage) : null;

      const result = completeSlideReload(outputDir, toSlideIndex(1), content, stagedImage);

      expect(result).toMatchObject({
        success: true,
        slide: { slideIndex: 1, notes: "Fresh", preview: null },
      });
      expect(fs.existsSync(previousImage)).toBe(false);
      expect(stagedImagePath === null || fs.existsSync(stagedImagePath)).toBe(true);
    },
  );
});

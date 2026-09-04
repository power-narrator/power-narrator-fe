import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { XmlPptProvider } from "./XmlPptProvider.js";
import type { NativePlatformProvider } from "./PptProvider.js";
import type { QuerySlidesResult } from "./types.js";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    isPackaged: false,
  },
}));

let tempDir: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function createNativeProvider(
  reloadSlideImage: NativePlatformProvider["reloadSlideImage"],
): NativePlatformProvider {
  return {
    closePresentation: vi.fn().mockResolvedValue(1),
    exportSlideImages: vi.fn().mockResolvedValue({ success: false, message: "Not used" }),
    generateVideo: vi.fn().mockResolvedValue({ success: false, message: "Not used" }),
    playSlide: vi.fn().mockResolvedValue({ success: false, message: "Not used" }),
    reloadSlideImage,
    reopenPresentation: vi.fn().mockResolvedValue(undefined),
  };
}

type QuerySlides = (filePath: string) => Promise<QuerySlidesResult>;

describe("XmlPptProvider.reloadSlide", () => {
  it("uses the requested slide notes and commits only its staged image", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-xml-provider-"));
    const outputDir = path.join(tempDir, "deck");
    const slidesDir = path.join(outputDir, "slides");
    fs.mkdirSync(slidesDir, { recursive: true });

    const previousImage = path.join(slidesDir, "Slide_2_previous.png");
    const stagedImage = path.join(slidesDir, "Slide_2_staged.png");
    const otherSlideImage = path.join(slidesDir, "Slide_20_existing.png");
    for (const imagePath of [previousImage, stagedImage, otherSlideImage]) {
      fs.writeFileSync(imagePath, "fixture");
    }

    const reloadSlideImage = vi
      .fn<NativePlatformProvider["reloadSlideImage"]>()
      .mockResolvedValue({ success: true, image: "slides/Slide_2_staged.png" });
    const provider = new XmlPptProvider(createNativeProvider(reloadSlideImage));
    const querySlides = vi
      .spyOn(provider as unknown as { querySlides: QuerySlides }, "querySlides")
      .mockResolvedValue({
        success: true,
        slideData: [
          { notes: "First slide", audio: [] },
          { notes: "Fresh\r\nnotes", audio: [] },
        ],
      });

    const result = await provider.reloadSlide("/presentations/deck.pptx", 2, outputDir);

    expect(reloadSlideImage).toHaveBeenCalledWith("/presentations/deck.pptx", 2, outputDir);
    expect(querySlides).toHaveBeenCalledWith("/presentations/deck.pptx");
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.message);
    }
    expect(result.slide).toMatchObject({
      index: 2,
      image: "slides/Slide_2_staged.png",
      notes: "Fresh\nnotes",
    });
    expect(fs.existsSync(stagedImage)).toBe(true);
    expect(fs.existsSync(previousImage)).toBe(false);
    expect(fs.existsSync(otherSlideImage)).toBe(true);
  });
});

import fs from "node:fs";
import { app } from "electron";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { XmlPptProvider } from "./XmlPptProvider.js";
import type { NativePlatformProvider } from "./PptProvider.js";
import type { QuerySlidesResult, RunXmlCliResult, XmlCliOperation } from "./types.js";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: vi.fn<(name: string) => string>(() => process.cwd()),
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
    closePresentation: vi
      .fn<NativePlatformProvider["closePresentation"]>()
      .mockResolvedValue(toSlideIndex(0)),
    exportSlideImages: vi
      .fn<NativePlatformProvider["exportSlideImages"]>()
      .mockResolvedValue({ success: false, message: "Not used" }),
    generateVideo: vi
      .fn<NativePlatformProvider["generateVideo"]>()
      .mockResolvedValue({ success: false, message: "Not used" }),
    playSlide: vi
      .fn<NativePlatformProvider["playSlide"]>()
      .mockResolvedValue({ success: false, message: "Not used" }),
    reloadSlideImage,
    reopenPresentation: vi.fn<NativePlatformProvider["reopenPresentation"]>(() =>
      Promise.resolve(),
    ),
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

    const result = await provider.reloadSlide(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );

    expect(reloadSlideImage).toHaveBeenCalledWith(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );
    expect(querySlides).toHaveBeenCalledWith("/presentations/deck.pptx");
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.message);
    }
    expect(result.slide).toMatchObject({
      slideIndex: 1,
      image: "slides/Slide_2_staged.png",
      notes: "Fresh\nnotes",
    });
    expect(fs.existsSync(stagedImage)).toBe(true);
    expect(fs.existsSync(previousImage)).toBe(false);
    expect(fs.existsSync(otherSlideImage)).toBe(true);
  });
});

type RunXmlCli = (
  inputPath: string,
  outputPath: string | null,
  ops: XmlCliOperation[],
  options?: { skipClose?: boolean; skipReopen?: boolean },
) => Promise<RunXmlCliResult>;

function spyOnRunXmlCli(provider: XmlPptProvider) {
  return vi
    .spyOn(provider as unknown as { runXmlCli: RunXmlCli }, "runXmlCli")
    .mockResolvedValue({ success: true, data: { results: [] } });
}

describe("XmlPptProvider slide addressing", () => {
  it("hands the CLI its already 0-based slide index when saving notes", async () => {
    const provider = new XmlPptProvider();
    const runXmlCli = spyOnRunXmlCli(provider);

    await provider.saveNotes("/presentations/deck.pptx", [
      { slideIndex: toSlideIndex(0), notes: "First" },
      { slideIndex: toSlideIndex(4), notes: "Fifth" },
    ]);

    expect(runXmlCli).toHaveBeenCalledWith("/presentations/deck.pptx", "/presentations/deck.pptx", [
      { op: "set_slide_notes", args: { slide_index: 0, notes: "First" } },
      { op: "set_slide_notes", args: { slide_index: 4, notes: "Fifth" } },
    ]);
  });

  it("deletes audio from the requested slide indices without renumbering them", async () => {
    const provider = new XmlPptProvider();
    const runXmlCli = spyOnRunXmlCli(provider);
    vi.spyOn(provider as unknown as { querySlides: QuerySlides }, "querySlides").mockResolvedValue({
      success: true,
      slideData: [
        { notes: "First", audio: [{ name: "ppt_audio_1.mp3" }] },
        { notes: "Second", audio: [{ name: "ppt_audio_1.mp3" }] },
        { notes: "Third", audio: [{ name: "ppt_audio_1.mp3" }, { name: "narrator.mp3" }] },
      ],
    });

    const result = await provider.removeAudio("/presentations/deck.pptx", [
      toSlideIndex(0),
      toSlideIndex(2),
    ]);

    expect(result).toEqual({ success: true, data: { results: [] } });
    expect(runXmlCli).toHaveBeenCalledWith(
      "/presentations/deck.pptx",
      "/presentations/deck.pptx",
      [
        { op: "delete_audio_for_slide", args: { slide_index: 0, name: "ppt_audio_1.mp3" } },
        { op: "delete_audio_for_slide", args: { slide_index: 2, name: "ppt_audio_1.mp3" } },
      ],
      { skipClose: true, skipReopen: true },
    );
  });

  it("reports a slide index the presentation does not have", async () => {
    const provider = new XmlPptProvider();
    spyOnRunXmlCli(provider);
    vi.spyOn(provider as unknown as { querySlides: QuerySlides }, "querySlides").mockResolvedValue({
      success: true,
      slideData: [{ notes: "First", audio: [] }],
    });

    await expect(
      provider.removeAudio("/presentations/deck.pptx", [toSlideIndex(3)]),
    ).resolves.toEqual({
      success: false,
      message: "Could not find slide data for slide 4",
    });
  });

  it("keys all slide notes by their presentation-wide slide index", async () => {
    const provider = new XmlPptProvider();
    vi.spyOn(provider as unknown as { querySlides: QuerySlides }, "querySlides").mockResolvedValue({
      success: true,
      slideData: [
        { notes: "First", audio: [] },
        { notes: "Second\r\nnotes", audio: [] },
      ],
    });

    const result = await provider.readAllSlideNotes("/presentations/deck.pptx");

    expect(result).toEqual({
      success: true,
      notes: new Map([
        [0, "First"],
        [1, "Second\nnotes"],
      ]),
    });
  });
});

describe("XmlPptProvider.insertAudio", () => {
  it("saves audio against the slide index the CLI already counts from zero", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-xml-audio-"));
    // `app.getPath` is an Electron-owned method; mocking it requires an unbound reference.
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(app.getPath).mockReturnValue(tempDir);
    const provider = new XmlPptProvider();
    const runXmlCli = spyOnRunXmlCli(provider);
    vi.spyOn(provider as unknown as { querySlides: QuerySlides }, "querySlides").mockResolvedValue({
      success: true,
      slideData: [
        { notes: "First", audio: [] },
        { notes: "Second", audio: [] },
        { notes: "Third", audio: [] },
      ],
    });

    await provider.insertAudio("/presentations/deck.pptx", [
      { slideIndex: toSlideIndex(0), sectionIndex: 0, audioData: new Uint8Array([1]) },
      { slideIndex: toSlideIndex(2), sectionIndex: 1, audioData: new Uint8Array([2]) },
    ]);

    const [, , ops] = runXmlCli.mock.calls[0]!;
    expect(ops.map((op) => ({ op: op.op, slide_index: op.args.slide_index }))).toEqual([
      { op: "save_audio_for_slide", slide_index: 0 },
      { op: "save_audio_for_slide", slide_index: 2 },
    ]);
  });
});

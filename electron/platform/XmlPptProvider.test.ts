import fs from "node:fs";
import { app } from "electron";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { XmlPptProvider } from "./XmlPptProvider.js";
import type { NativePlatformProvider } from "./PptProvider.js";
import type { XmlCliOperation, XmlCliResponse, XmlSlideData } from "./types.js";

type XmlCliRequest = {
  input: string;
  output: string | null;
  ops: XmlCliOperation[];
};

const xmlCliCalls: XmlCliRequest[] = [];
const xmlCliResponses: XmlCliResponse[] = [];

vi.mock("node:child_process", () => ({
  spawn: (_command: string, [requestPath, responsePath]: string[]) => {
    xmlCliCalls.push(JSON.parse(fs.readFileSync(requestPath!, "utf8")) as XmlCliRequest);
    const listeners = new Map<string, (value: string | number) => void>();

    queueMicrotask(() => {
      const response = xmlCliResponses.shift() ?? { results: [] };
      fs.writeFileSync(responsePath!, JSON.stringify(response), "utf8");
      listeners.get("close")?.(0);
    });

    return {
      stdout: {
        on: (_: string, cb: (value: string | number) => void) => listeners.set("stdout", cb),
      },
      stderr: {
        on: (_: string, cb: (value: string | number) => void) => listeners.set("stderr", cb),
      },
      on: (event: string, cb: (value: string | number) => void) => listeners.set(event, cb),
    };
  },
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: vi.fn<(name: string) => string>(() => process.cwd()),
    isPackaged: false,
  },
}));

let tempDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-xml-provider-"));
  // `app.getPath` is an Electron-owned method; mocking it requires an unbound reference.
  // oxlint-disable-next-line typescript/unbound-method
  vi.mocked(app.getPath).mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  xmlCliCalls.length = 0;
  xmlCliResponses.length = 0;
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function respondWithSlides(slideData: XmlSlideData[]): void {
  xmlCliResponses.push({
    results: [{ success: true, result: slideData, message: "" }],
  });
}

function respondWithSuccess(): void {
  xmlCliResponses.push({ results: [] });
}

function createNativeProvider(
  overrides: Partial<NativePlatformProvider> = {},
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
    reloadSlideImage: vi
      .fn<NativePlatformProvider["reloadSlideImage"]>()
      .mockResolvedValue({ success: false, message: "Not used" }),
    reopenPresentation: vi.fn<NativePlatformProvider["reopenPresentation"]>(() =>
      Promise.resolve(),
    ),
    ...overrides,
  };
}

describe("XmlPptProvider loading", () => {
  it("loads every slide with none of its section audio playing across slides", async () => {
    const provider = new XmlPptProvider(
      createNativeProvider({
        exportSlideImages: vi.fn<NativePlatformProvider["exportSlideImages"]>().mockResolvedValue({
          success: true,
          images: new Map([
            [toSlideIndex(0), { image: "slides/Slide_1.png" }],
            [toSlideIndex(1), { image: "slides/Slide_2.png" }],
          ]),
        }),
      }),
    );
    respondWithSlides([
      { notes: "First", audio: [{ name: "ppt_audio_1" }] },
      { notes: "Second\r\nnotes", audio: [] },
    ]);

    const result = await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(result).toMatchObject({
      success: true,
      slides: [
        {
          slideIndex: 0,
          image: "slides/Slide_1.png",
          notes: "First",
          sectionsPlayingAcrossSlides: new Set(),
        },
        {
          slideIndex: 1,
          image: "slides/Slide_2.png",
          notes: "Second\nnotes",
          sectionsPlayingAcrossSlides: new Set(),
        },
      ],
    });
  });
});

describe("XmlPptProvider.reloadSlide", () => {
  it("uses the requested slide notes, with no section audio playing across slides, and commits only its staged image", async () => {
    if (!tempDir) {
      throw new Error("Expected a temporary test directory");
    }
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
    const provider = new XmlPptProvider(createNativeProvider({ reloadSlideImage }));
    respondWithSlides([
      { notes: "First slide", audio: [] },
      { notes: "Fresh\r\nnotes", audio: [{ name: "ppt_audio_1" }] },
    ]);

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
    expect(result).toMatchObject({
      success: true,
      slide: {
        slideIndex: 1,
        image: "slides/Slide_2_staged.png",
        notes: "Fresh\nnotes",
        sectionsPlayingAcrossSlides: new Set(),
      },
    });
    expect(fs.existsSync(stagedImage)).toBe(true);
    expect(fs.existsSync(previousImage)).toBe(false);
    expect(fs.existsSync(otherSlideImage)).toBe(true);
  });
});

describe("XmlPptProvider slide addressing", () => {
  it("hands the CLI its already 0-based slide index when saving notes", async () => {
    const provider = new XmlPptProvider();
    respondWithSuccess();

    await provider.saveNotes("/presentations/deck.pptx", [
      { slideIndex: toSlideIndex(0), notes: "First" },
      { slideIndex: toSlideIndex(4), notes: "Fifth" },
    ]);

    expect(xmlCliCalls).toEqual([
      {
        input: "/presentations/deck.pptx",
        output: "/presentations/deck.pptx",
        ops: [
          { op: "set_slide_notes", args: { slide_index: 0, notes: "First" } },
          { op: "set_slide_notes", args: { slide_index: 4, notes: "Fifth" } },
        ],
      },
    ]);
  });

  it("removes only section audio from requested slides", async () => {
    const provider = new XmlPptProvider();
    respondWithSlides([
      { notes: "First", audio: [{ name: "ppt_audio_1" }] },
      { notes: "Second", audio: [{ name: "ppt_audio_1" }] },
      {
        notes: "Third",
        audio: [
          { name: "ppt_audio_12" },
          { name: "narrator.mp3" },
          { name: "ppt_audio_backup" },
          { name: "ppt_audioAnything" },
          { name: "ppt_audio_" },
          { name: "ppt_audio_0" },
          { name: "ppt_audio_01" },
          { name: "ppt_audio_-1" },
          { name: "ppt_audio_1.5" },
          { name: "ppt_audio_1.mp3" },
          { name: "PPT_AUDIO_1" },
        ],
      },
    ]);
    respondWithSuccess();

    const result = await provider.removeAudio("/presentations/deck.pptx", [
      toSlideIndex(0),
      toSlideIndex(2),
    ]);

    expect(result).toEqual({ success: true, data: { results: [] } });
    expect(xmlCliCalls).toEqual([
      {
        input: "/presentations/deck.pptx",
        output: null,
        ops: [{ op: "get_slides", args: {} }],
      },
      {
        input: "/presentations/deck.pptx",
        output: "/presentations/deck.pptx",
        ops: [
          { op: "delete_audio_for_slide", args: { slide_index: 0, name: "ppt_audio_1" } },
          { op: "delete_audio_for_slide", args: { slide_index: 2, name: "ppt_audio_12" } },
        ],
      },
    ]);
  });

  it("reports a slide index the presentation does not have", async () => {
    const provider = new XmlPptProvider();
    respondWithSlides([{ notes: "First", audio: [] }]);

    await expect(
      provider.removeAudio("/presentations/deck.pptx", [toSlideIndex(3)]),
    ).resolves.toEqual({
      success: false,
      message: "Could not find slide data for slide 4",
    });
  });

  it("keys all slide notes by their presentation-wide slide index", async () => {
    const provider = new XmlPptProvider();
    respondWithSlides([
      { notes: "First", audio: [] },
      { notes: "Second\r\nnotes", audio: [] },
    ]);

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

describe("XmlPptProvider.saveSlideNarration", () => {
  it("saves the notes before the section audio and reports the notes saved when the audio fails", async () => {
    const provider = new XmlPptProvider();
    respondWithSuccess();
    respondWithSlides([{ notes: "First", audio: [] }]);

    const result = await provider.saveSlideNarration("/presentations/deck.pptx", {
      slideIndex: toSlideIndex(3),
      notes: "Fourth",
      audio: [],
    });

    expect(result).toEqual({
      success: false,
      saved: "notes",
      message: "Could not find slide data for slide 4",
    });
    expect(xmlCliCalls.map(({ ops }) => ops)).toEqual([
      [{ op: "set_slide_notes", args: { slide_index: 3, notes: "Fourth" } }],
      [{ op: "get_slides", args: {} }],
    ]);
  });
});

describe("XmlPptProvider.insertAudio", () => {
  it("replaces section audio only on requested slides", async () => {
    const provider = new XmlPptProvider();
    respondWithSlides([
      { notes: "First", audio: [{ name: "ppt_audio_1" }, { name: "ppt_audio_2" }] },
      { notes: "Second", audio: [{ name: "ppt_audio_1" }] },
      { notes: "Third", audio: [{ name: "ppt_audio_backup" }] },
    ]);
    respondWithSuccess();

    await provider.insertAudio("/presentations/deck.pptx", [
      {
        slideIndex: toSlideIndex(0),
        sectionIndex: 0,
        audioData: new Uint8Array([1]),
        playAcrossSlides: true,
      },
      {
        slideIndex: toSlideIndex(2),
        sectionIndex: 1,
        audioData: new Uint8Array([2]),
        playAcrossSlides: false,
      },
    ]);

    expect(xmlCliCalls[1]?.ops).toEqual([
      { op: "delete_audio_for_slide", args: { slide_index: 0, name: "ppt_audio_1" } },
      { op: "delete_audio_for_slide", args: { slide_index: 0, name: "ppt_audio_2" } },
      {
        op: "save_audio_for_slide",
        args: {
          slide_index: 0,
          mp3_path: expect.stringContaining(`${path.sep}ppt_audio_1.mp3`) as unknown,
        },
      },
      {
        op: "save_audio_for_slide",
        args: {
          slide_index: 2,
          mp3_path: expect.stringContaining(`${path.sep}ppt_audio_2.mp3`) as unknown,
        },
      },
    ]);
  });
});

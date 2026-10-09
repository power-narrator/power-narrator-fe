import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { MacPptProvider } from "./MacPptProvider.js";

const spawnCalls: Array<{ command: string; args: string[] }> = [];
let spawnStdout = "";
let beforeSpawnClose: (() => void) | undefined;

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const listeners = new Map<string, (value: string) => void>();

    queueMicrotask(() => {
      beforeSpawnClose?.();
      if (spawnStdout) {
        listeners.get("stdout")?.(spawnStdout);
      }
      listeners.get("close")?.("");
    });

    return {
      stdout: { on: (_: string, cb: (value: string) => void) => listeners.set("stdout", cb) },
      stderr: { on: () => {} },
      on: (event: string, cb: (value: string) => void) => listeners.set(event, cb),
    };
  },
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn<() => string>(() => process.cwd()),
    getPath: vi.fn<(name: string) => string>(),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn<() => unknown[]>(() => []),
  },
}));

let tempDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-mac-provider-"));
  // `app.getPath` is an Electron-owned method; mocking it requires an unbound reference.
  // oxlint-disable-next-line typescript/unbound-method
  vi.mocked(app.getPath).mockReturnValue(tempDir);
  fs.mkdirSync(path.join(tempDir, "Library/Group Containers/UBF8T346G9.Office"), {
    recursive: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  spawnCalls.length = 0;
  spawnStdout = "";
  beforeSpawnClose = undefined;
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("MacPptProvider.reloadSlideImage", () => {
  it("derives the 1-based slide number the image export script expects", async () => {
    const provider = new MacPptProvider();
    spawnStdout = JSON.stringify({
      success: true,
      data: { image: "slides/Slide_7_uuid.png" },
    });
    if (!tempDir) {
      throw new Error("Expected a temporary test directory");
    }
    const outputDir = path.join(tempDir, "deck");

    const result = await provider.reloadSlideImage(
      "/presentations/deck.pptx",
      toSlideIndex(6),
      outputDir,
    );

    expect(spawnCalls.at(-1)).toEqual({
      command: "osascript",
      args: [
        expect.stringMatching(/export-slide-images\.applescript$/),
        "/presentations/deck.pptx",
        outputDir,
        "7",
      ],
    });
    expect(result).toEqual({ success: true, image: "slides/Slide_7_uuid.png" });
  });
});

function officeContainerPath(fileName: string): string {
  if (!tempDir) {
    throw new Error("Expected a temporary test directory");
  }

  return path.join(tempDir, "Library/Group Containers/UBF8T346G9.Office", fileName);
}

/**
 * The macro seam takes 1-based slide numbers, so capture what the provider
 * writes while the fake AppleScript process runs, before cleanup removes it.
 */
function succeedAppleScript(capture: () => void = () => {}) {
  spawnStdout = JSON.stringify({ success: true, data: {} });
  beforeSpawnClose = capture;
}

describe("MacPptProvider native slide numbers", () => {
  it("writes notes blocks under the 1-based slide number the macro expects", async () => {
    const provider = new MacPptProvider();
    let notesData = "";
    succeedAppleScript(() => {
      const params = fs.readFileSync(officeContainerPath("update_notes_params.txt"), "utf8");
      notesData = fs.readFileSync(params.split("|")[1]!, "utf8");
    });

    await provider.saveNotes("/presentations/deck.pptx", [
      { slideIndex: toSlideIndex(0), notes: "First" },
      { slideIndex: toSlideIndex(4), notes: "Fifth" },
    ]);

    expect(notesData).toBe(
      "###SLIDE_START### 1\nFirst\n###SLIDE_END###\n###SLIDE_START### 5\nFifth\n###SLIDE_END###\n",
    );
  });

  it("names the 1-based slide numbers the remove-audio macro expects", async () => {
    const provider = new MacPptProvider();
    let params = "";
    succeedAppleScript(() => {
      params = fs.readFileSync(officeContainerPath("remove_audio_params.txt"), "utf8");
    });

    await provider.removeAudio("/presentations/deck.pptx", [toSlideIndex(0), toSlideIndex(2)]);

    expect(params).toBe("/presentations/deck.pptx|1,3");
  });

  it("starts the slideshow at the 1-based slide number", async () => {
    const provider = new MacPptProvider();
    succeedAppleScript();

    await provider.playSlide("/presentations/deck.pptx", toSlideIndex(0));

    expect(spawnCalls.at(-1)).toEqual({
      command: "osascript",
      args: [expect.stringMatching(/play-slide\.applescript$/), "1", "/presentations/deck.pptx"],
    });
  });
});

describe("MacPptProvider presentation lifecycle", () => {
  it("converts the current 1-based slide number AppleScript reports into a slide index", async () => {
    spawnStdout = "5\n";

    await expect(new MacPptProvider().closePresentation("/presentations/deck.pptx")).resolves.toBe(
      toSlideIndex(4),
    );
  });

  it.each([
    ["no slide", ""],
    ["nothing numeric", "closed"],
  ])("falls back to the first slide when PowerPoint reports %s", async (_, stdout) => {
    spawnStdout = stdout;

    await expect(new MacPptProvider().closePresentation("/presentations/deck.pptx")).resolves.toBe(
      toSlideIndex(0),
    );
  });

  it("reopens the presentation on the 1-based slide number", async () => {
    await new MacPptProvider().reopenPresentation("/presentations/deck.pptx", toSlideIndex(4));

    expect(spawnCalls.at(-1)?.args.slice(-2)).toEqual(["/presentations/deck.pptx", "5"]);
  });
});

describe("MacPptProvider.exportSlideImages", () => {
  it("reads the manifest's 1-based slide numbers as slide indices", async () => {
    if (!tempDir) {
      throw new Error("Expected a temporary test directory");
    }

    const provider = new MacPptProvider();
    const manifestPath = path.join(tempDir, "images.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify([
        { slideNumber: 1, image: "slides/Slide_1_uuid.png" },
        { slideNumber: 4, image: "slides/Slide_4_uuid.png" },
      ]),
    );
    spawnStdout = JSON.stringify({ success: true, data: { manifestPath } });

    const result = await provider.exportSlideImages("/presentations/deck.pptx", "/tmp/deck");

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.message);
    }
    expect([...result.images]).toEqual([
      [0, { image: "slides/Slide_1_uuid.png" }],
      [3, { image: "slides/Slide_4_uuid.png" }],
    ]);
  });
});

/**
 * Plays the inspection macro: it reads the slides it was asked about and
 * writes its report to the output path named in its parameters.
 */
function reportSectionAudioPlayback(report: string | null) {
  const request = { slideNumbers: "" };
  succeedAppleScript(() => {
    const [, slideNumbers, outputPath] = fs
      .readFileSync(officeContainerPath("export_audio_playback_params.txt"), "utf8")
      .split("|");
    request.slideNumbers = slideNumbers!;
    if (report !== null) {
      fs.writeFileSync(outputPath!, report);
    }
  });
  return request;
}

function stubSlideExport(provider: MacPptProvider, slideIndices: number[]) {
  vi.spyOn(provider, "exportSlideImages").mockResolvedValue({
    success: true,
    images: new Map(
      slideIndices.map((index) => [
        toSlideIndex(index),
        { image: `slides/Slide_${index + 1}_uuid.png` },
      ]),
    ),
  });
  vi.spyOn(provider, "readAllSlideNotes").mockResolvedValue({
    success: true,
    notes: new Map(slideIndices.map((index) => [toSlideIndex(index), `Slide ${index + 1}`])),
  });
}

describe("MacPptProvider section audio playback", () => {
  it("reads which sections' audio plays across slides by slide number and section ordinal", async () => {
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0, 3]);
    const request = reportSectionAudioPlayback(
      [
        "###SLIDE_START### 1",
        "###SLIDE_END###",
        "###SLIDE_START### 4",
        "ppt_audio_1\tsound\t0",
        "ppt_audio_2\tsound\t999",
        "ppt_audio_3\tsound\t2",
        "ppt_audio_4\tsound\t1",
        "###SLIDE_END###",
        "###EXPORT_COMPLETE###",
        "",
      ].join("\n"),
    );

    const result = await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(request.slideNumbers).toBe("1,4");
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.message);
    }
    expect(
      result.slides.map(({ slideIndex, sectionsPlayingAcrossSlides }) => ({
        slideIndex,
        sectionsPlayingAcrossSlides,
      })),
    ).toEqual([
      { slideIndex: 0, sectionsPlayingAcrossSlides: new Set() },
      { slideIndex: 3, sectionsPlayingAcrossSlides: new Set([1, 2]) },
    ]);
  });

  it.each([
    [
      "two audio shapes share a section's name",
      "###SLIDE_START### 1\nppt_audio_1\tsound\t999\nppt_audio_1\tsound\t0\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "Slide 1 has more than one shape named ppt_audio_1.",
    ],
    [
      "the named shape is not audio",
      "###SLIDE_START### 1\nppt_audio_1\tother\t\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "Shape ppt_audio_1 on slide 1 is not audio.",
    ],
    [
      "PowerPoint reports an inspection error",
      "###ERROR### Could not read the playback of ppt_audio_1 on slide 1: Type mismatch\n",
      "Could not read the playback of ppt_audio_1 on slide 1: Type mismatch",
    ],
    [
      "the playback value is unreadable",
      "###SLIDE_START### 1\nppt_audio_1\tsound\tlots\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported an unreadable playback for ppt_audio_1 on slide 1.",
    ],
    [
      "the report stops before completing",
      "###SLIDE_START### 1\n###SLIDE_END###\n",
      "PowerPoint did not finish reporting section audio playback.",
    ],
    [
      "a requested slide is missing from the report",
      "###EXPORT_COMPLETE###\n",
      "PowerPoint did not report section audio playback for slide 1.",
    ],
    ["no report is written", null, "PowerPoint did not report section audio playback."],
  ])("fails the load when %s", async (_, report, message) => {
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0]);
    reportSectionAudioPlayback(report);

    await expect(provider.convertPptx("/presentations/deck.pptx", "/tmp/deck")).resolves.toEqual({
      success: false,
      message,
    });
  });

  it("reads the playback of the reloaded slide only", async () => {
    if (!tempDir) {
      throw new Error("Expected a temporary test directory");
    }
    const outputDir = path.join(tempDir, "deck");
    fs.mkdirSync(path.join(outputDir, "slides"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "slides/Slide_2_staged.png"), "fixture");
    const provider = new MacPptProvider();
    vi.spyOn(provider, "reloadSlideImage").mockResolvedValue({
      success: true,
      image: "slides/Slide_2_staged.png",
    });
    vi.spyOn(provider, "readSlideNotes").mockResolvedValue({ success: true, notes: "Second" });
    const request = reportSectionAudioPlayback(
      "###SLIDE_START### 2\nppt_audio_1\tsound\t999\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );

    const result = await provider.reloadSlide(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );

    expect(request.slideNumbers).toBe("2");
    expect(result).toMatchObject({
      success: true,
      slide: { slideIndex: 1, notes: "Second", sectionsPlayingAcrossSlides: new Set([0]) },
    });
  });
});

describe("MacPptProvider.convertPptx", () => {
  it("keeps each slide's own index when only some slides exported", async () => {
    const provider = new MacPptProvider();
    reportSectionAudioPlayback(
      "###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 4\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );
    vi.spyOn(provider, "exportSlideImages").mockResolvedValue({
      success: true,
      images: new Map([
        [toSlideIndex(3), { image: "slides/Slide_4_uuid.png" }],
        [toSlideIndex(0), { image: "slides/Slide_1_uuid.png" }],
      ]),
    });
    vi.spyOn(provider, "readAllSlideNotes").mockResolvedValue({
      success: true,
      notes: new Map([
        [toSlideIndex(0), "First"],
        [toSlideIndex(3), "Fourth"],
      ]),
    });

    const result = await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.message);
    }
    expect(result.slides.map(({ slideIndex, notes }) => ({ slideIndex, notes }))).toEqual([
      { slideIndex: 0, notes: "First" },
      { slideIndex: 3, notes: "Fourth" },
    ]);
  });
});

describe("MacPptProvider.insertAudio", () => {
  const deck = "/presentations/deck.pptx";
  const firstAndThirdSlideAudio = [
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
  ];
  const confirmedFirst = "inserted|1|ppt_audio_1|999|1|0";
  const confirmedThird = "inserted|3|ppt_audio_2|1|1|0";

  /**
   * Stands in for the InsertAudio macro: the provider learns the outcome only
   * from the report the macro writes to the result path named in its params.
   */
  function insertAudioMacroReports(report: string | undefined) {
    let params = "";
    succeedAppleScript(() => {
      params = fs.readFileSync(officeContainerPath("insert_audio_params.txt"), "utf8");
      const [, resultPath] = params.split(/\r?\n/)[0]!.split("|");
      if (report !== undefined) {
        fs.writeFileSync(resultPath!, report);
      }
    });
    return () => params;
  }

  it("succeeds once the macro confirms each section audio, its playback, and the narration left on each slide", async () => {
    const provider = new MacPptProvider();
    const params = insertAudioMacroReports(
      [confirmedFirst, confirmedThird, "slide|1|ppt_audio_1", "slide|3|ppt_audio_2", "done"].join(
        "\r",
      ),
    );

    const result = await provider.insertAudio(deck, firstAndThirdSlideAudio);

    expect(result).toEqual({ success: true });
    expect(
      params()
        .trimEnd()
        .split("\n")
        .slice(1)
        .map((line) => {
          const [slideNumber, , playAcrossSlides] = line.split("|");
          return [slideNumber, playAcrossSlides];
        }),
    ).toEqual([
      ["1", "1"],
      ["3", "0"],
    ]);
  });

  it.each([
    {
      problem: "writes no report",
      report: undefined,
      message: /did not report/,
    },
    {
      problem: "stops before finishing",
      report: `${confirmedFirst}\n`,
      message: /did not finish/,
    },
    {
      problem: "reports an error",
      report: "error|Presentation not found: /presentations/deck.pptx\n",
      message: /Presentation not found/,
    },
    {
      problem: "does not confirm a section audio",
      report: `${confirmedFirst}\nslide|1|ppt_audio_1\nslide|3|ppt_audio_2\ndone\n`,
      message: /ppt_audio_2 on slide 3/,
    },
    {
      problem: "leaves an enabled section on a custom span",
      report: [
        "inserted|1|ppt_audio_1|2|1|0",
        confirmedThird,
        "slide|1|ppt_audio_1",
        "slide|3|ppt_audio_2",
        "done",
      ].join("\n"),
      message: /playback of ppt_audio_1 on slide 1/,
    },
    {
      problem: "leaves an enabled section waiting for its audio",
      report: [
        "inserted|1|ppt_audio_1|999|1|1",
        confirmedThird,
        "slide|1|ppt_audio_1",
        "slide|3|ppt_audio_2",
        "done",
      ].join("\n"),
      message: /playback of ppt_audio_1 on slide 1/,
    },
    {
      problem: "leaves a disabled section playing across slides",
      report: [
        confirmedFirst,
        "inserted|3|ppt_audio_2|999|1|0",
        "slide|1|ppt_audio_1",
        "slide|3|ppt_audio_2",
        "done",
      ].join("\n"),
      message: /playback of ppt_audio_2 on slide 3/,
    },
    {
      problem: "does not report a section's playback",
      report: [
        confirmedFirst,
        "inserted|3|ppt_audio_2",
        "slide|1|ppt_audio_1",
        "slide|3|ppt_audio_2",
        "done",
      ].join("\n"),
      message: /playback of ppt_audio_2 on slide 3/,
    },
    {
      problem: "leaves obsolete section audio on a saved slide",
      report: [
        confirmedFirst,
        confirmedThird,
        "slide|1|ppt_audio_1,ppt_audio_2",
        "slide|3|ppt_audio_2",
        "done",
      ].join("\n"),
      message: /slide 1.*ppt_audio_1,ppt_audio_2/,
    },
    {
      problem: "leaves duplicate section audio on a saved slide",
      report: [
        confirmedFirst,
        confirmedThird,
        "slide|1|ppt_audio_1",
        "slide|3|ppt_audio_2,ppt_audio_2",
        "done",
      ].join("\n"),
      message: /slide 3/,
    },
  ])("fails when the macro $problem", async ({ report, message }) => {
    const provider = new MacPptProvider();
    insertAudioMacroReports(report);

    const result = await provider.insertAudio(deck, firstAndThirdSlideAudio);

    expect(result).toEqual({ success: false, message: expect.stringMatching(message) as unknown });
  });
});

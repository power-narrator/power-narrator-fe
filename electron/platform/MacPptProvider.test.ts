import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { MacPptProvider } from "./MacPptProvider.js";

type ScriptOutcome = { stdout?: string; stderr?: string; code?: number };

const spawnCalls: Array<{ command: string; args: string[] }> = [];
let spawnStdout = "";
let beforeSpawnClose: (() => void) | undefined;
const scriptOutcomes = new Map<string, ScriptOutcome>();
/** What each fake macro does while trigger-macro.applescript runs it, keyed by macro name. */
const macroRuns = new Map<string, () => void>();
/** What each fake AppleScript does while it runs, keyed by script file name. */
const scriptRuns = new Map<string, (args: string[]) => void>();

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const listeners = new Map<string, (value: unknown) => void>();
    const script = path.basename(args[0] ?? "");
    const outcome = scriptOutcomes.get(script) ?? { stdout: spawnStdout };

    queueMicrotask(() => {
      beforeSpawnClose?.();
      scriptRuns.get(script)?.(args.slice(1));
      if (script === "trigger-macro.applescript") {
        macroRuns.get(args[1] ?? "")?.();
      }
      if (outcome.stdout) {
        listeners.get("stdout")?.(outcome.stdout);
      }
      if (outcome.stderr) {
        listeners.get("stderr")?.(outcome.stderr);
      }
      listeners.get("close")?.(outcome.code ?? 0);
    });

    return {
      stdout: { on: (_: string, cb: (value: unknown) => void) => listeners.set("stdout", cb) },
      stderr: { on: (_: string, cb: (value: unknown) => void) => listeners.set("stderr", cb) },
      on: (event: string, cb: (value: unknown) => void) => listeners.set(event, cb),
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

function testDir(): string {
  if (!tempDir) {
    throw new Error("Expected a temporary test directory");
  }
  return tempDir;
}

/** A file where the preview export folder goes stops the export before any AppleScript runs. */
function blockPreviewExportFolder(): void {
  fs.writeFileSync(path.join(testDir(), "power-narrator"), "not a folder");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-mac-provider-"));
  // `app.getPath` is an Electron-owned method; mocking it requires an unbound reference.
  // oxlint-disable-next-line typescript/unbound-method
  vi.mocked(app.getPath).mockReturnValue(tempDir);
  fs.mkdirSync(path.join(testDir(), "Library/Group Containers/UBF8T346G9.Office"), {
    recursive: true,
  });
});

/** Restoring spies alone leaves module-factory mocks with a test's return values. */
function resetMocks() {
  vi.resetAllMocks();
  vi.restoreAllMocks();
}

afterEach(() => {
  resetMocks();
  spawnCalls.length = 0;
  spawnStdout = "";
  beforeSpawnClose = undefined;
  scriptOutcomes.clear();
  macroRuns.clear();
  scriptRuns.clear();
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
    const outputDir = path.join(testDir(), "deck");

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
  return path.join(testDir(), "Library/Group Containers/UBF8T346G9.Office", fileName);
}

function openAppWindow() {
  const appWindow = { show: vi.fn<() => void>(), focus: vi.fn<() => void>() };
  // oxlint-disable-next-line typescript/unbound-method
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([appWindow as never]);
  return appWindow;
}

function scriptsRun(): string[][] {
  return spawnCalls.map(({ args: [script = "", ...args] }) => [path.basename(script), ...args]);
}

/**
 * The macro seam takes 1-based slide numbers, so capture what the provider
 * writes while the fake macro process runs, before cleanup removes it.
 */
function succeedAppleScript(capture: () => void = () => {}) {
  spawnStdout = JSON.stringify({ success: true, data: {} });
  beforeSpawnClose = () => {
    beforeSpawnClose = undefined;
    capture();
  };
}

describe("MacPptProvider native slide numbers", () => {
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
    const provider = new MacPptProvider();
    const manifestPath = path.join(testDir(), "images.json");
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
  spawnStdout = JSON.stringify({ success: true, data: {} });
  macroRuns.set("ExportSectionAudioPlayback", () => {
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

const NOTES_PARAMS = {
  ExportAllSlideNotes: "export_all_notes_params.txt",
  ExportSlideNotes: "export_slide_notes_params.txt",
};

/** Plays a notes export macro, which writes its report to the last path in its parameters. */
function reportNotes(macro: keyof typeof NOTES_PARAMS, report: string | null) {
  const request = { params: "" };
  spawnStdout = JSON.stringify({ success: true, data: {} });
  macroRuns.set(macro, () => {
    request.params = fs.readFileSync(officeContainerPath(NOTES_PARAMS[macro]), "utf8");
    if (report !== null) {
      fs.writeFileSync(request.params.split("|").at(-1)!, report);
    }
  });
  return request;
}

/** A complete notes report for a presentation whose slides have these notes, in order. */
function notesReport(...notes: string[]): string {
  return [
    `###SLIDE_COUNT### ${notes.length}`,
    ...notes.flatMap((text, i) => [
      `###SLIDE_START### ${i + 1}`,
      ...(text ? [text] : []),
      "###SLIDE_END###",
    ]),
    "###EXPORT_COMPLETE###",
    "",
  ].join("\n");
}

/** A complete playback report for slides with no section audio. */
function noPlaybackReport(...slideNumbers: number[]): string {
  return [
    ...slideNumbers.flatMap((n) => [`###SLIDE_START### ${n}`, "###SLIDE_END###"]),
    "###EXPORT_COMPLETE###",
    "",
  ].join("\n");
}

function stubImageExport(provider: MacPptProvider, slideIndices: number[]) {
  return vi.spyOn(provider, "exportSlideImages").mockResolvedValue({
    success: true,
    images: new Map(
      slideIndices.map((index) => [
        toSlideIndex(index),
        { image: `slides/Slide_${index + 1}_uuid.png` },
      ]),
    ),
  });
}

function stubSlideExport(provider: MacPptProvider, slideIndices: number[]) {
  const imageExport = stubImageExport(provider, slideIndices);
  vi.spyOn(provider, "readAllSlideNotes").mockResolvedValue({
    success: true,
    notes: new Map(slideIndices.map((index) => [toSlideIndex(index), `Slide ${index + 1}`])),
  });
  return imageExport;
}

describe("MacPptProvider section audio playback", () => {
  it("reads each section audio's Play Across Slides checkbox by slide number and section ordinal", async () => {
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0, 3]);
    const request = reportSectionAudioPlayback(
      [
        "###SLIDE_START### 1",
        "###SLIDE_END###",
        "###SLIDE_START### 4",
        "ppt_audio_1\tfalse",
        "ppt_audio_2\ttrue",
        "ppt_audio_3\ttrue",
        "ppt_audio_4\tfalse",
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
      "###SLIDE_START### 1\nppt_audio_1\ttrue\nppt_audio_1\tfalse\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "Slide 1 has more than one shape named ppt_audio_1.",
    ],
    [
      "PowerPoint reports an inspection error",
      "###ERROR### Could not read the playback of ppt_audio_1 on slide 1: Type mismatch\n",
      "Could not read the playback of ppt_audio_1 on slide 1: Type mismatch",
    ],
    [
      "the playback value is unreadable",
      "###SLIDE_START### 1\nppt_audio_1\tlots\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported an unreadable playback for ppt_audio_1 on slide 1.",
    ],
    [
      "the checkbox value is numeric",
      "###SLIDE_START### 1\nppt_audio_1\t83\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported an unreadable playback for ppt_audio_1 on slide 1.",
    ],
    [
      "a section audio's playback is missing",
      "###SLIDE_START### 1\nppt_audio_1\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported an unreadable playback for ppt_audio_1 on slide 1.",
    ],
    [
      "a playback record has extra fields",
      "###SLIDE_START### 1\nppt_audio_1\ttrue\t999\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported an unreadable playback for ppt_audio_1 on slide 1.",
    ],
    [
      "the report stops before completing",
      "###SLIDE_START### 1\n###SLIDE_END###\n",
      "PowerPoint did not finish reporting section audio playback.",
    ],
    [
      "a slide's report is not closed",
      "###SLIDE_START### 1\nppt_audio_1\ttrue\n###EXPORT_COMPLETE###\n",
      "PowerPoint did not finish reporting section audio playback for slide 1.",
    ],
    [
      "a playback is reported outside any slide",
      "ppt_audio_1\ttrue\n###SLIDE_START### 1\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported playback outside a slide: ppt_audio_1\ttrue",
    ],
    [
      "a slide's number is unreadable",
      "###SLIDE_START### first\nppt_audio_1\ttrue\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported an unreadable slide: first",
    ],
    [
      "a slide is reported twice",
      "###SLIDE_START### 1\nppt_audio_1\ttrue\n###SLIDE_END###\n###SLIDE_START### 1\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported section audio playback for slide 1 more than once.",
    ],
    [
      "a slide is closed without being opened",
      "###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported playback outside a slide: ###SLIDE_END###",
    ],
    [
      "a requested slide is missing from the report",
      "###EXPORT_COMPLETE###\n",
      "PowerPoint did not report section audio playback for slide 1.",
    ],
    ["no report is written", null, "PowerPoint did not report section audio playback."],
  ])("fails the load without exporting slide images when %s", async (_, report, message) => {
    const provider = new MacPptProvider();
    const imageExport = stubSlideExport(provider, [0]);
    reportSectionAudioPlayback(report);

    await expect(provider.convertPptx("/presentations/deck.pptx", "/tmp/deck")).resolves.toEqual({
      success: false,
      message,
    });
    expect(imageExport).not.toHaveBeenCalled();
  });

  it("returns focus to the app when PowerPoint fails to read the checkboxes", async () => {
    const appWindow = openAppWindow();
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0]);
    reportSectionAudioPlayback("###ERROR### Target presentation has no editing window\n");

    await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(appWindow.focus).toHaveBeenCalled();
  });

  it("resets the app window mock between tests to no window and no recorded calls", () => {
    // oxlint-disable-next-line typescript/unbound-method
    const getAllWindows = vi.mocked(BrowserWindow.getAllWindows);
    getAllWindows.mockReturnValue([{} as never]);
    getAllWindows();

    resetMocks();

    expect(getAllWindows).not.toHaveBeenCalled();
    expect(getAllWindows()).toEqual([]);
  });

  it("hands focus back to the app PowerPoint was brought in front of to read the checkboxes", async () => {
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0]);
    reportSectionAudioPlayback("###SLIDE_START### 1\n###SLIDE_END###\n###EXPORT_COMPLETE###\n");
    scriptOutcomes.set("trigger-macro.applescript", {
      stdout: JSON.stringify({ success: true, data: { previousApp: "/Applications/Notes.app/" } }),
    });

    await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(scriptsRun()).toEqual([
      [
        "trigger-macro.applescript",
        "ExportSectionAudioPlayback",
        "/presentations/deck.pptx",
        "target-window",
      ],
      ["restore-foreground.applescript", "/Applications/Notes.app/"],
    ]);
  });

  it("reads the playback of the reloaded slide only", async () => {
    const outputDir = path.join(testDir(), "deck");
    fs.mkdirSync(path.join(outputDir, "slides"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "slides/Slide_2_staged.png"), "fixture");
    const provider = new MacPptProvider();
    vi.spyOn(provider, "reloadSlideImage").mockResolvedValue({
      success: true,
      image: "slides/Slide_2_staged.png",
    });
    vi.spyOn(provider, "readSlideNotes").mockResolvedValue({ success: true, notes: "Second" });
    const request = reportSectionAudioPlayback(
      "###SLIDE_START### 2\nppt_audio_1\ttrue\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
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
  it("keeps all 72 slides with their notes and settings when only 10 previews export", async () => {
    const provider = new MacPptProvider();
    const previewed = [0, 7, 15, 22, 30, 38, 45, 53, 60, 71];
    stubImageExport(provider, previewed);
    const notes = Array.from({ length: 72 }, (_, i) => `Notes ${i + 1}`);
    reportNotes("ExportAllSlideNotes", notesReport(...notes));
    const playback = reportSectionAudioPlayback(
      [
        "###SLIDE_START### 5\nppt_audio_1\ttrue\n###SLIDE_END###",
        ...notes.flatMap((_, i) =>
          i === 4 ? [] : [`###SLIDE_START### ${i + 1}`, "###SLIDE_END###"],
        ),
        "###EXPORT_COMPLETE###",
        "",
      ].join("\n"),
    );

    const result = await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    if (!result.success) {
      throw new Error(result.message);
    }
    expect(playback.slideNumbers.split(",")).toHaveLength(72);
    expect(result.slides).toHaveLength(72);
    expect(result.slides.map(({ slideIndex, notes }) => ({ slideIndex, notes }))).toEqual(
      notes.map((text, i) => ({ slideIndex: i, notes: text })),
    );
    expect(result.slides.filter(({ preview }) => preview === null)).toHaveLength(62);
    expect(result.slides[4]).toMatchObject({
      preview: null,
      sectionsPlayingAcrossSlides: new Set([0]),
    });
    expect(result.slides[7]?.preview?.image).toBe("slides/Slide_8_uuid.png");
    expect(result.slides[7]?.preview?.src).toContain(
      encodeURIComponent("/tmp/deck/slides/Slide_8_uuid.png"),
    );
  });

  it("opens every slide without previews when the whole image export fails", async () => {
    const provider = new MacPptProvider();
    vi.spyOn(provider, "exportSlideImages").mockResolvedValue({
      success: false,
      message: "PowerPoint could not export images",
    });
    reportNotes("ExportAllSlideNotes", notesReport("First", "Second"));
    reportSectionAudioPlayback(noPlaybackReport(1, 2));

    await expect(
      provider.convertPptx("/presentations/deck.pptx", "/tmp/deck"),
    ).resolves.toMatchObject({
      success: true,
      slides: [
        { slideIndex: 0, notes: "First", preview: null },
        { slideIndex: 1, notes: "Second", preview: null },
      ],
    });
  });

  it("opens every slide without previews when the preview export folder cannot be created", async () => {
    blockPreviewExportFolder();
    const provider = new MacPptProvider();
    reportNotes("ExportAllSlideNotes", notesReport("First", "Second"));
    reportSectionAudioPlayback(
      "###SLIDE_START### 1\nppt_audio_1\ttrue\n###SLIDE_END###\n###SLIDE_START### 2\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );

    await expect(
      provider.convertPptx("/presentations/deck.pptx", "/tmp/deck"),
    ).resolves.toMatchObject({
      success: true,
      slides: [
        {
          slideIndex: 0,
          notes: "First",
          sectionsPlayingAcrossSlides: new Set([0]),
          preview: null,
        },
        { slideIndex: 1, notes: "Second", sectionsPlayingAcrossSlides: new Set(), preview: null },
      ],
    });
  });

  it("treats a slide the exporter reported without an image as having no preview", async () => {
    const provider = new MacPptProvider();
    vi.spyOn(provider, "exportSlideImages").mockResolvedValue({
      success: true,
      images: new Map([
        [toSlideIndex(0), { image: "" }],
        [toSlideIndex(1), { image: "slides/Slide_2_uuid.png" }],
      ]),
    });
    reportNotes("ExportAllSlideNotes", notesReport("First", "Second"));
    reportSectionAudioPlayback(noPlaybackReport(1, 2));

    await expect(
      provider.convertPptx("/presentations/deck.pptx", "/tmp/deck"),
    ).resolves.toMatchObject({
      success: true,
      slides: [
        { slideIndex: 0, preview: null },
        { slideIndex: 1, preview: { image: "slides/Slide_2_uuid.png" } },
      ],
    });
  });
});

/** Like the real export script, a whole-deck export rebuilds the slides folder before writing. */
function rebuildSlidesOnImageExport() {
  scriptRuns.set("export-slide-images.applescript", ([, outputDir, slideNumber]) => {
    if (slideNumber === undefined) {
      fs.rmSync(path.join(outputDir!, "slides"), { recursive: true, force: true });
      fs.mkdirSync(path.join(outputDir!, "slides"), { recursive: true });
    }
  });
}

function readSlidesDir(outputDir: string): Record<string, string> {
  const slidesDir = path.join(outputDir, "slides");
  return Object.fromEntries(
    fs
      .readdirSync(slidesDir)
      .map((name) => [name, fs.readFileSync(path.join(slidesDir, name), "utf8")]),
  );
}

describe("MacPptProvider Reload All", () => {
  it.each([
    ["the notes cannot be read", "###ERROR### Automation error\n", noPlaybackReport(1, 2)],
    [
      "the Play Across Slides checkboxes cannot be read",
      notesReport("First", "Second"),
      "###ERROR### Target presentation has no editing window\n",
    ],
  ])("leaves the previews in use untouched on disk when %s", async (_, notes, playback) => {
    const provider = new MacPptProvider();
    const outputDir = path.join(testDir(), "deck");
    fs.mkdirSync(path.join(outputDir, "slides"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "slides/Slide_1_in_use.png"), "first preview");
    fs.writeFileSync(path.join(outputDir, "slides/Slide_2_in_use.png"), "second preview");
    rebuildSlidesOnImageExport();
    reportNotes("ExportAllSlideNotes", notes);
    reportSectionAudioPlayback(playback);

    const result = await provider.convertPptx("/presentations/deck.pptx", outputDir);

    expect(result.success).toBe(false);
    expect(readSlidesDir(outputDir)).toEqual({
      "Slide_1_in_use.png": "first preview",
      "Slide_2_in_use.png": "second preview",
    });
  });

  it.each([
    ["the preview export folder cannot be created", blockPreviewExportFolder],
    [
      "the preview export rejects",
      (provider: MacPptProvider) =>
        vi.spyOn(provider, "exportSlideImages").mockRejectedValue(new Error("PowerPoint quit")),
    ],
  ])(
    "accepts the fresh notes and playback without the previous previews when %s",
    async (_, failPreviewExport) => {
      const provider = new MacPptProvider();
      const outputDir = path.join(testDir(), "deck");
      fs.mkdirSync(path.join(outputDir, "slides"), { recursive: true });
      fs.writeFileSync(path.join(outputDir, "slides/Slide_1_in_use.png"), "first preview");
      failPreviewExport(provider);
      reportNotes("ExportAllSlideNotes", notesReport("Fresh"));
      reportSectionAudioPlayback(
        "###SLIDE_START### 1\nppt_audio_1\ttrue\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      );

      await expect(provider.convertPptx("/presentations/deck.pptx", outputDir)).resolves.toEqual({
        success: true,
        slides: [
          {
            slideIndex: 0,
            notes: "Fresh",
            sectionsPlayingAcrossSlides: new Set([0]),
            preview: null,
          },
        ],
      });
    },
  );
});

function saveNarrationMacroReports(report: string | undefined) {
  const request = { params: "", notes: "" };
  succeedAppleScript(() => {
    request.params = fs.readFileSync(officeContainerPath("save_narration_params.txt"), "utf8");
    const [, resultPath, notesPath] = request.params.split(/\r?\n/)[0]!.split("|");
    if (notesPath) {
      request.notes = fs.readFileSync(notesPath, "utf8");
    }
    if (report !== undefined) {
      fs.writeFileSync(resultPath!, report);
    }
  });
  return request;
}

describe("MacPptProvider notes reports", () => {
  it("loads genuinely blank notes as empty", async () => {
    const provider = new MacPptProvider();
    stubImageExport(provider, [0, 1]);
    reportNotes("ExportAllSlideNotes", notesReport("", "Second"));
    reportSectionAudioPlayback(noPlaybackReport(1, 2));

    const result = await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(result).toMatchObject({
      success: true,
      slides: [
        { slideIndex: 0, notes: "" },
        { slideIndex: 1, notes: "Second" },
      ],
    });
  });

  it.each([
    [
      "PowerPoint cannot read a slide's notes",
      "###ERROR### Could not read the notes of slide 2: Automation error\n",
      "Could not read the notes of slide 2: Automation error",
    ],
    [
      "the report stops before completing",
      "###SLIDE_COUNT### 2\n###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 2\n###SLIDE_END###\n",
      "PowerPoint did not finish reporting slide notes.",
    ],
    ["the report is empty", "", "PowerPoint did not report how many slides the presentation has."],
    [
      "the slide count is missing",
      "###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 2\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint did not report how many slides the presentation has.",
    ],
    [
      "the slide count is unreadable",
      "###SLIDE_COUNT### two\n###EXPORT_COMPLETE###\n",
      "PowerPoint did not report how many slides the presentation has.",
    ],
    [
      "a slide is missing from the report",
      "###SLIDE_COUNT### 2\n###SLIDE_START### 1\nFirst\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint did not report the notes of slide 2.",
    ],
    [
      "a slide's notes are not closed",
      "###SLIDE_COUNT### 2\n###SLIDE_START### 1\nFirst\n###SLIDE_START### 2\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint did not finish reporting the notes of slide 1.",
    ],
    [
      "the last slide's notes are not closed",
      "###SLIDE_COUNT### 2\n###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 2\nSecond\n###EXPORT_COMPLETE###\n",
      "PowerPoint did not finish reporting the notes of slide 2.",
    ],
    [
      "a slide's number is unreadable",
      "###SLIDE_COUNT### 2\n###SLIDE_START### first\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported notes for an unreadable slide: first",
    ],
    [
      "a slide is reported twice",
      "###SLIDE_COUNT### 2\n###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 2\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported the notes of slide 1 more than once.",
    ],
    [
      "a slide is beyond the reported slide count",
      "###SLIDE_COUNT### 2\n###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 2\n###SLIDE_END###\n###SLIDE_START### 3\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported notes for slide 3 of a 2-slide presentation.",
    ],
    [
      "notes are reported outside any slide",
      "###SLIDE_COUNT### 2\nStray\n###SLIDE_START### 1\n###SLIDE_END###\n###SLIDE_START### 2\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported notes outside a slide: Stray",
    ],
    ["no report is written", null, "PowerPoint did not report slide notes."],
  ])("fails the load without exporting slide images when %s", async (_, report, message) => {
    const provider = new MacPptProvider();
    const imageExport = stubImageExport(provider, [0, 1]);
    reportNotes("ExportAllSlideNotes", report);
    reportSectionAudioPlayback(noPlaybackReport(1, 2));

    await expect(provider.convertPptx("/presentations/deck.pptx", "/tmp/deck")).resolves.toEqual({
      success: false,
      message,
    });
    expect(imageExport).not.toHaveBeenCalled();
  });
});

describe("MacPptProvider.reloadSlide", () => {
  function stageReloadedImage(provider: MacPptProvider) {
    const outputDir = path.join(testDir(), "deck");
    fs.mkdirSync(path.join(outputDir, "slides"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "slides/Slide_2_previous.png"), "previous");
    const reloadSlideImage = vi.spyOn(provider, "reloadSlideImage").mockImplementation(() => {
      fs.writeFileSync(path.join(outputDir, "slides/Slide_2_staged.png"), "staged");
      return Promise.resolve({ success: true, image: "slides/Slide_2_staged.png" });
    });
    return { outputDir, reloadSlideImage };
  }

  it("reads the 1-based slide's notes, accepting genuinely blank notes", async () => {
    const provider = new MacPptProvider();
    const { outputDir } = stageReloadedImage(provider);
    const notes = reportNotes(
      "ExportSlideNotes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 2\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );
    reportSectionAudioPlayback(noPlaybackReport(2));

    const result = await provider.reloadSlide(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );

    expect(notes.params.split("|").slice(0, 2)).toEqual(["/presentations/deck.pptx", "2"]);
    expect(result).toMatchObject({
      success: true,
      slide: { slideIndex: 1, preview: { image: "slides/Slide_2_staged.png" }, notes: "" },
    });
  });

  it.each([
    [
      "PowerPoint cannot read the slide's notes",
      "###ERROR### Could not read the notes of slide 2: Automation error\n",
      noPlaybackReport(2),
      "Could not read the notes of slide 2: Automation error",
    ],
    [
      "PowerPoint reports another slide's notes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 1\nFirst\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      noPlaybackReport(2),
      "PowerPoint did not report the notes of slide 2.",
    ],
    [
      "PowerPoint cannot read the slide's Play Across Slides checkboxes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 2\nSecond\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "###ERROR### Target presentation has no editing window\n",
      "Target presentation has no editing window",
    ],
  ])(
    "keeps the previous image and exports no new one when %s",
    async (_, notesReportText, playbackReport, message) => {
      const provider = new MacPptProvider();
      const { outputDir, reloadSlideImage } = stageReloadedImage(provider);
      reportNotes("ExportSlideNotes", notesReportText);
      reportSectionAudioPlayback(playbackReport);

      const result = await provider.reloadSlide(
        "/presentations/deck.pptx",
        toSlideIndex(1),
        outputDir,
      );

      expect(result).toEqual({ success: false, message });
      expect(reloadSlideImage).not.toHaveBeenCalled();
      expect(fs.readdirSync(path.join(outputDir, "slides"))).toEqual(["Slide_2_previous.png"]);
    },
  );

  it("accepts the fresh notes and playback without the previous image when the preview fails to export", async () => {
    const provider = new MacPptProvider();
    const { outputDir, reloadSlideImage } = stageReloadedImage(provider);
    fs.writeFileSync(path.join(outputDir, "slides/Slide_3_other.png"), "other");
    reloadSlideImage.mockResolvedValue({
      success: false,
      message: "PowerPoint could not export the slide image",
    });
    reportNotes(
      "ExportSlideNotes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 2\nFresh\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );
    reportSectionAudioPlayback(
      "###SLIDE_START### 2\nppt_audio_1\ttrue\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );

    const result = await provider.reloadSlide(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );

    expect(result).toEqual({
      success: true,
      slide: {
        slideIndex: 1,
        preview: null,
        notes: "Fresh",
        sectionsPlayingAcrossSlides: new Set([0]),
      },
    });
    expect(fs.readdirSync(path.join(outputDir, "slides"))).toEqual(["Slide_3_other.png"]);
  });

  it("accepts the fresh notes and playback without the previous image when the preview export rejects", async () => {
    const provider = new MacPptProvider();
    const { outputDir, reloadSlideImage } = stageReloadedImage(provider);
    fs.writeFileSync(path.join(outputDir, "slides/Slide_3_other.png"), "other");
    reloadSlideImage.mockRejectedValue(new Error("PowerPoint quit"));
    reportNotes(
      "ExportSlideNotes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 2\nFresh\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );
    reportSectionAudioPlayback(
      "###SLIDE_START### 2\nppt_audio_1\ttrue\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );

    const result = await provider.reloadSlide(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );

    expect(result).toEqual({
      success: true,
      slide: {
        slideIndex: 1,
        preview: null,
        notes: "Fresh",
        sectionsPlayingAcrossSlides: new Set([0]),
      },
    });
    expect(readSlidesDir(outputDir)).toEqual({ "Slide_3_other.png": "other" });
  });

  it("restores the preview and drops the previous image once the preview exports again", async () => {
    const provider = new MacPptProvider();
    const { outputDir } = stageReloadedImage(provider);
    reportNotes(
      "ExportSlideNotes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 2\nFresh\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );
    reportSectionAudioPlayback(noPlaybackReport(2));

    const result = await provider.reloadSlide(
      "/presentations/deck.pptx",
      toSlideIndex(1),
      outputDir,
    );

    expect(result).toMatchObject({
      success: true,
      slide: { slideIndex: 1, notes: "Fresh", preview: { image: "slides/Slide_2_staged.png" } },
    });
    expect(fs.readdirSync(path.join(outputDir, "slides"))).toEqual(["Slide_2_staged.png"]);
  });
  it("reports a failure instead of throwing when the reloaded slide cannot be built", async () => {
    const provider = new MacPptProvider();
    const { outputDir, reloadSlideImage } = stageReloadedImage(provider);
    const unencodableImage = "slides/Slide_2_\uD800.png";
    reloadSlideImage.mockImplementation(() => {
      fs.writeFileSync(path.join(outputDir, unencodableImage), "staged");
      return Promise.resolve({ success: true, image: unencodableImage });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportNotes(
      "ExportSlideNotes",
      "###SLIDE_COUNT### 3\n###SLIDE_START### 2\nFresh\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
    );
    reportSectionAudioPlayback(noPlaybackReport(2));

    await expect(
      provider.reloadSlide("/presentations/deck.pptx", toSlideIndex(1), outputDir),
    ).resolves.toEqual({ success: false, message: "URI malformed" });
  });
});

describe("MacPptProvider.saveSlideNarration", () => {
  const deck = "/presentations/deck.pptx";
  const thirdSlide = {
    slideIndex: toSlideIndex(2),
    notes: "First\n---\nSecond",
    audio: [
      {
        slideIndex: toSlideIndex(2),
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
    ],
  };
  const savedThirdSlide = [
    "editing",
    "inserted|3|ppt_audio_1|true",
    "inserted|3|ppt_audio_2|false",
    "slide|3|ppt_audio_1,ppt_audio_2",
    "saved",
    "done",
  ];

  it("hands the macro the slide's notes and section audio under its 1-based slide number", async () => {
    const provider = new MacPptProvider();
    const request = saveNarrationMacroReports(savedThirdSlide.join("\r"));

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({ success: true });
    const [header = "", ...audioLines] = request.params.trimEnd().split("\n");
    expect(header.split("|")).toEqual([deck, expect.any(String), expect.any(String), "3"]);
    expect(audioLines.map((line) => line.split("|"))).toEqual([
      ["3", expect.stringMatching(/ppt_audio_1\.mp3$/), "1"],
      ["3", expect.stringMatching(/ppt_audio_2\.mp3$/), "0"],
    ]);
    expect(request.notes).toBe("###SLIDE_START### 3\nFirst\n---\nSecond\n###SLIDE_END###\n");
    expect(scriptsRun()).toEqual([
      ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
    ]);
  });

  it("hands focus back to the app PowerPoint was brought in front of, rather than raising this app", async () => {
    const appWindow = openAppWindow();
    const provider = new MacPptProvider();
    saveNarrationMacroReports(savedThirdSlide.join("\n"));
    scriptOutcomes.set("trigger-macro.applescript", {
      stdout: JSON.stringify({ success: true, data: { previousApp: "/Applications/Notes.app/" } }),
    });

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({ success: true });
    expect(scriptsRun()).toEqual([
      ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
      ["restore-foreground.applescript", "/Applications/Notes.app/"],
    ]);
    expect(appWindow.show).not.toHaveBeenCalled();
    expect(appWindow.focus).not.toHaveBeenCalled();
  });

  it.each([
    ["saving", savedThirdSlide.join("\n")],
    ["reopening the presentation after a failed edit", "editing\nerror|Could not insert.\n"],
  ])(
    "leaves focus alone after %s when PowerPoint was not brought to the front",
    async (_, report) => {
      const appWindow = openAppWindow();
      const provider = new MacPptProvider();
      saveNarrationMacroReports(report);

      await provider.saveSlideNarration(deck, thirdSlide);

      expect(scriptsRun().map(([script]) => script)).not.toContain(
        "restore-foreground.applescript",
      );
      expect(appWindow.show).not.toHaveBeenCalled();
      expect(appWindow.focus).not.toHaveBeenCalled();
    },
  );

  it("hands focus back when the macro fails after PowerPoint was brought to the front", async () => {
    const provider = new MacPptProvider();
    scriptOutcomes.set("trigger-macro.applescript", {
      stdout: JSON.stringify({
        success: false,
        message: "Error calling macro 'SaveNarration': The macro cannot be found.",
        data: { previousApp: "/Applications/Notes.app/" },
      }),
    });

    await provider.saveSlideNarration(deck, thirdSlide);

    expect(scriptsRun().at(-1)).toEqual([
      "restore-foreground.applescript",
      "/Applications/Notes.app/",
    ]);
  });

  it("hands focus back only after reopening the presentation when a failed edit is discarded", async () => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports("editing\nerror|Could not insert.\n");
    scriptOutcomes.set("trigger-macro.applescript", {
      stdout: JSON.stringify({ success: true, data: { previousApp: "/Applications/Notes.app/" } }),
    });

    await provider.saveSlideNarration(deck, thirdSlide);

    expect(scriptsRun().map(([script]) => script)).toEqual([
      "trigger-macro.applescript",
      "close-presentation.applescript",
      "reopen-presentation.applescript",
      "restore-foreground.applescript",
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
      report: "editing\ninserted|3|ppt_audio_1|true\n",
      message: /did not finish/,
    },
    {
      problem: "finishes without saving",
      report: savedThirdSlide.filter((record) => record !== "saved").join("\n"),
      message: /did not save the presentation/,
    },
    {
      problem: "does not confirm a section audio",
      report: savedThirdSlide.filter((record) => !record.includes("ppt_audio_2|")).join("\n"),
      message: /ppt_audio_2 on slide 3/,
    },
    {
      problem: "leaves an enabled section's checkbox unchecked",
      report: savedThirdSlide.join("\n").replace("ppt_audio_1|true", "ppt_audio_1|false"),
      message: /playback of ppt_audio_1 on slide 3/,
    },
    {
      problem: "leaves a disabled section's checkbox checked",
      report: savedThirdSlide.join("\n").replace("ppt_audio_2|false", "ppt_audio_2|true"),
      message: /playback of ppt_audio_2 on slide 3/,
    },
    {
      problem: "reports a numeric checkbox value",
      report: savedThirdSlide.join("\n").replace("ppt_audio_1|true", "ppt_audio_1|999"),
      message: /unreadable playback for ppt_audio_1 on slide 3/,
    },
    {
      problem: "reports an unreadable checkbox",
      report: savedThirdSlide.join("\n").replace("ppt_audio_2|false", "ppt_audio_2|False"),
      message: /unreadable playback for ppt_audio_2 on slide 3/,
    },
    {
      problem: "reports extra playback fields",
      report: savedThirdSlide.join("\n").replace("ppt_audio_2|false", "ppt_audio_2|false|1|0"),
      message: /unreadable playback for ppt_audio_2 on slide 3/,
    },
    {
      problem: "does not report a section's playback",
      report: savedThirdSlide.join("\n").replace("ppt_audio_2|false", "ppt_audio_2"),
      message: /unreadable playback for ppt_audio_2 on slide 3/,
    },
    {
      problem: "does not report the section audio left on the slide",
      report: savedThirdSlide.filter((record) => !record.startsWith("slide|")).join("\n"),
      message: /section audio left on slide 3/,
    },
    {
      problem: "leaves obsolete section audio on the slide",
      report: savedThirdSlide.join("\n").replace("slide|3|", "slide|3|ppt_audio_3,"),
      message: /slide 3.*ppt_audio_3,ppt_audio_1,ppt_audio_2/,
    },
    {
      problem: "leaves duplicate section audio on the slide",
      report: savedThirdSlide.join("\n").replace("slide|3|", "slide|3|ppt_audio_1,"),
      message: /slide 3/,
    },
  ])("fails when the macro $problem", async ({ report, message }) => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(report);

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toMatchObject({
      success: false,
      message: expect.stringMatching(message) as unknown,
    });
  });

  it.each([
    {
      failure: "PowerPoint cannot save the presentation before changing it",
      report: "error|The file is read-only.\n",
      message: "The file is read-only.",
    },
    {
      failure: "the presentation has no such slide",
      report: "error|Slide 3 does not exist.\n",
      message: "Slide 3 does not exist.",
    },
  ])("leaves the presentation open as it was when $failure", async ({ report, message }) => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(report);

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({ success: false, saved: "nothing", message });
    expect(scriptsRun()).toEqual([
      ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
    ]);
  });

  it("leaves the presentation open when the macro cannot run", async () => {
    const provider = new MacPptProvider();
    scriptOutcomes.set("trigger-macro.applescript", {
      stdout: JSON.stringify({
        success: false,
        message: "Error calling macro 'SaveNarration': The macro cannot be found.",
      }),
    });

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({
      success: false,
      saved: "nothing",
      message: "Error calling macro 'SaveNarration': The macro cannot be found.",
    });
    expect(scriptsRun()).toEqual([
      ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
    ]);
  });

  it.each([
    ["has not reported anything yet", ""],
    ["has reported only its first save", "editing\ninserted|3|ppt_audio_1|true\n"],
  ])(
    "reopens the presentation as last saved, reporting the slide's narration as unknown, when PowerPoint stops responding after the macro started and %s",
    async (_, report) => {
      const provider = new MacPptProvider();
      saveNarrationMacroReports(report);
      scriptOutcomes.set("trigger-macro.applescript", {
        stdout: JSON.stringify({
          success: false,
          message: "Error calling macro 'SaveNarration': AppleEvent timed out.",
        }),
      });

      const result = await provider.saveSlideNarration(deck, thirdSlide);

      expect(result).toEqual({
        success: false,
        saved: "unknown",
        message: expect.stringMatching(
          /^Error calling macro 'SaveNarration': AppleEvent timed out\. PowerPoint did not report whether it saved .*closed without saving and reopened as last saved/,
        ) as unknown,
      });
      expect(scriptsRun()).toEqual([
        ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
        ["close-presentation.applescript", deck, "discard"],
        ["reopen-presentation.applescript", deck, "1"],
      ]);
    },
  );

  it("keeps the presentation open and reports the slide saved when PowerPoint stops responding after saving it", async () => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(savedThirdSlide.filter((record) => record !== "done").join("\n"));
    scriptOutcomes.set("trigger-macro.applescript", {
      stdout: JSON.stringify({
        success: false,
        message: "Error calling macro 'SaveNarration': AppleEvent timed out.",
      }),
    });

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({
      success: false,
      saved: "notesAndAudio",
      message: "Error calling macro 'SaveNarration': AppleEvent timed out.",
    });
    expect(scriptsRun()).toEqual([
      ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
    ]);
  });

  it("leaves the presentation open when the section audio cannot be staged for PowerPoint", async () => {
    const provider = new MacPptProvider();
    fs.writeFileSync(officeContainerPath("TemporaryAudio"), "not a directory");

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({
      success: false,
      saved: "nothing",
      message: expect.stringMatching(/^Could not prepare the files PowerPoint needs/) as unknown,
    });
    expect(scriptsRun()).toEqual([]);
  });

  it.each([
    [
      "checking the section audio",
      "editing\nerror|ppt_audio_1 on slide 3 fades in or out, which replacing its audio cannot keep.\n",
    ],
    ["writing the notes", "editing\nerror|Could not write the notes of slide 3.\n"],
    [
      "changing the section audio",
      "editing\ninserted|3|ppt_audio_1|true\nerror|Could not insert ppt_audio_2 on slide 3.\n",
    ],
    [
      "confirming the section audio left on the slide",
      "editing\ninserted|3|ppt_audio_1|true\ninserted|3|ppt_audio_2|false\nslide|3|ppt_audio_1,ppt_audio_2,ppt_audio_3\nerror|Section audio on slide 3 is ppt_audio_1,ppt_audio_2,ppt_audio_3 instead of ppt_audio_1,ppt_audio_2.\n",
    ],
  ])(
    "reopens the presentation as saved before the change when %s fails, so a later save cannot keep the failed edits",
    async (_, report) => {
      const provider = new MacPptProvider();
      saveNarrationMacroReports(report);

      const result = await provider.saveSlideNarration(deck, thirdSlide);

      expect(result).toEqual({
        success: false,
        saved: "nothing",
        message: report.split("error|")[1]!.trimEnd(),
      });
      expect(scriptsRun()).toEqual([
        ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
        ["close-presentation.applescript", deck, "discard"],
        ["reopen-presentation.applescript", deck, "1"],
      ]);
    },
  );

  it.each([
    {
      problem: "the deck is no longer open under its path",
      outcome: ["close-presentation.applescript", { stdout: "not-open\n" }],
      message: /could not discard/,
    },
    {
      problem: "closing the deck fails",
      outcome: ["close-presentation.applescript", { stderr: "PowerPoint got an error.", code: 1 }],
      message: /could not discard.*PowerPoint got an error/,
    },
    {
      problem: "reopening the deck fails",
      outcome: ["reopen-presentation.applescript", { stderr: "File not found.", code: 1 }],
      message: /could not reopen.*File not found/,
    },
  ] as const)(
    "reports the macro error and a failed recovery when $problem",
    async ({ outcome: [script, outcome], message }) => {
      const provider = new MacPptProvider();
      saveNarrationMacroReports("editing\nerror|Could not insert ppt_audio_2 on slide 3.\n");
      scriptOutcomes.set(script, outcome);

      const result = await provider.saveSlideNarration(deck, thirdSlide);

      expect(result).toEqual({
        success: false,
        saved: "nothing",
        message: expect.stringMatching(
          new RegExp(`^Could not insert ppt_audio_2 on slide 3\\..*${message.source}`),
        ) as unknown,
      });
    },
  );

  it("keeps the presentation open and reports the slide saved when PowerPoint fails after saving it", async () => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(
      [
        ...savedThirdSlide.filter((record) => record !== "done"),
        "error|PowerPoint could not restore the previous editing view: Invalid request.",
      ].join("\n"),
    );

    const result = await provider.saveSlideNarration(deck, thirdSlide);

    expect(result).toEqual({
      success: false,
      saved: "notesAndAudio",
      message: "PowerPoint could not restore the previous editing view: Invalid request.",
    });
    expect(scriptsRun()).toEqual([
      ["trigger-macro.applescript", "SaveNarration", deck, "target-window"],
    ]);
  });
});

describe("MacPptProvider.removeAudio", () => {
  const deck = "/presentations/deck.pptx";
  const firstAndThirdSlides = [toSlideIndex(0), toSlideIndex(2)];

  it("asks the macro to leave no section audio on each 1-based slide number, without writing notes", async () => {
    const provider = new MacPptProvider();
    const request = saveNarrationMacroReports(
      "editing\r\nslide|1|\r\nslide|3|\r\nsaved\r\ndone\r\n",
    );

    const result = await provider.removeAudio(deck, firstAndThirdSlides);

    expect(result).toEqual({ success: true });
    expect(request.params.trimEnd().split("|")).toEqual([deck, expect.any(String), "", "1,3"]);
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
  });

  it.each([
    { problem: "writes no report", report: undefined, message: /did not report/ },
    {
      problem: "stops before finishing",
      report: "editing\nslide|1|\nslide|3|\n",
      message: /did not finish/,
    },
    {
      problem: "does not report a slide",
      report: "editing\nslide|1|\nsaved\ndone\n",
      message: /slide 3/,
    },
    {
      problem: "leaves section audio on a slide",
      report: "editing\nslide|1|\nslide|3|ppt_audio_2\nsaved\ndone\n",
      message: /slide 3.*ppt_audio_2/,
    },
  ])("fails when the macro $problem", async ({ report, message }) => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(report);

    const result = await provider.removeAudio(deck, firstAndThirdSlides);

    expect(result).toEqual({ success: false, message: expect.stringMatching(message) as unknown });
  });

  it("leaves the presentation open as it was when PowerPoint cannot save it before removing audio", async () => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports("error|The file is read-only.\n");

    const result = await provider.removeAudio(deck, firstAndThirdSlides);

    expect(result).toEqual({ success: false, message: "The file is read-only." });
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
  });

  it("reopens the presentation as saved before the removal when removing fails", async () => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(
      "editing\nslide|1|\nerror|Could not delete ppt_audio_1 on slide 3.\n",
    );

    const result = await provider.removeAudio(deck, firstAndThirdSlides);

    expect(result).toEqual({
      success: false,
      message: "Could not delete ppt_audio_1 on slide 3.",
    });
    expect(scriptsRun().slice(1)).toEqual([
      ["close-presentation.applescript", deck, "discard"],
      ["reopen-presentation.applescript", deck, "1"],
    ]);
  });

  it("reports the removal saved when PowerPoint fails after saving it", async () => {
    const provider = new MacPptProvider();
    saveNarrationMacroReports(
      "editing\nslide|1|\nslide|3|\nsaved\nerror|PowerPoint could not restore the previous editing view: Invalid request.\n",
    );

    const result = await provider.removeAudio(deck, firstAndThirdSlides);

    expect(result).toEqual({
      success: false,
      message:
        "PowerPoint removed the section audio and saved the presentation. PowerPoint could not restore the previous editing view: Invalid request.",
    });
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
  });
});

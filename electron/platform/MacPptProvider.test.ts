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
/** Outcomes for particular AppleScripts, keyed by file name; others print `spawnStdout`. */
const scriptOutcomes = new Map<string, ScriptOutcome>();

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const listeners = new Map<string, (value: unknown) => void>();
    const outcome = scriptOutcomes.get(path.basename(args[0] ?? "")) ?? { stdout: spawnStdout };

    queueMicrotask(() => {
      beforeSpawnClose?.();
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
  vi.resetAllMocks();
  vi.restoreAllMocks();
  spawnCalls.length = 0;
  spawnStdout = "";
  beforeSpawnClose = undefined;
  scriptOutcomes.clear();
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
      "an add-in older than the app reports a numeric playback span",
      "###SLIDE_START### 1\nppt_audio_1\t83\n###SLIDE_END###\n###EXPORT_COMPLETE###\n",
      "PowerPoint reported a numeric playback for ppt_audio_1 on slide 1; the installed PowerPoint add-in does not match this app.",
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
  ])("fails the load when %s", async (_, report, message) => {
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0]);
    reportSectionAudioPlayback(report);

    await expect(provider.convertPptx("/presentations/deck.pptx", "/tmp/deck")).resolves.toEqual({
      success: false,
      message,
    });
  });

  it("returns focus to the app after PowerPoint fails to read the checkboxes", async () => {
    const appWindow = { show: vi.fn<() => void>(), focus: vi.fn<() => void>() };
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([appWindow as never]);
    const provider = new MacPptProvider();
    stubSlideExport(provider, [0]);
    reportSectionAudioPlayback("###ERROR### Target presentation has no editing window\n");

    await provider.convertPptx("/presentations/deck.pptx", "/tmp/deck");

    expect(appWindow.focus).toHaveBeenCalled();
  });

  it("starts the next test without the focus test's app window or recorded calls", () => {
    // oxlint-disable-next-line typescript/unbound-method
    const getAllWindows = vi.mocked(BrowserWindow.getAllWindows);

    expect(getAllWindows).not.toHaveBeenCalled();
    expect(getAllWindows()).toEqual([]);
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

/**
 * Stands in for the SaveNarration macro: the provider learns the outcome only
 * from the report the macro writes to the result path named in its params.
 */
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
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
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
      problem: "reports a numeric playback, as an older add-in does",
      report: savedThirdSlide.join("\n").replace("ppt_audio_1|true", "ppt_audio_1|999|1|0"),
      message: /numeric playback for ppt_audio_1 on slide 3.*add-in does not match/,
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
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
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
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
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
        ["trigger-macro.applescript", "SaveNarration", deck],
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
    expect(scriptsRun()).toEqual([["trigger-macro.applescript", "SaveNarration", deck]]);
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

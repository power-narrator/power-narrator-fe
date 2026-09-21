import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { MacPptProvider } from "./MacPptProvider.js";

const spawnCalls: Array<{ command: string; args: string[] }> = [];
let spawnStdout = "";

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const listeners = new Map<string, (value: string) => void>();

    queueMicrotask(() => {
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

type RunAppleScriptJson = (
  scriptName: string,
  args: string[],
) => Promise<{ success: true; data: { image: string } } | { success: false; message: string }>;

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
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("MacPptProvider.reloadSlideImage", () => {
  it("derives the 1-based slide number the image export script expects", async () => {
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

    const result = await provider.reloadSlideImage(
      "/presentations/deck.pptx",
      toSlideIndex(6),
      outputDir,
    );

    expect(runAppleScriptJson).toHaveBeenCalledWith("export-slide-images.applescript", [
      "/presentations/deck.pptx",
      outputDir,
      "7",
    ]);
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
 * The macro and AppleScript seams take 1-based slide numbers, so these capture
 * what the provider writes before its `finally` block removes the files.
 */
function spyOnAppleScriptJson(provider: MacPptProvider, capture: () => void) {
  return vi
    .spyOn(provider as unknown as { runAppleScriptJson: RunAppleScriptJson }, "runAppleScriptJson")
    .mockImplementation(() => {
      capture();
      return Promise.resolve({ success: true, data: { image: "" } });
    });
}

describe("MacPptProvider native slide numbers", () => {
  it("writes notes blocks under the 1-based slide number the macro expects", async () => {
    const provider = new MacPptProvider();
    let notesData = "";
    spyOnAppleScriptJson(provider, () => {
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
    spyOnAppleScriptJson(provider, () => {
      params = fs.readFileSync(officeContainerPath("remove_audio_params.txt"), "utf8");
    });

    await provider.removeAudio("/presentations/deck.pptx", [toSlideIndex(0), toSlideIndex(2)]);

    expect(params).toBe("/presentations/deck.pptx|1,3");
  });

  it("starts the slideshow at the 1-based slide number", async () => {
    const provider = new MacPptProvider();
    const runAppleScriptJson = spyOnAppleScriptJson(provider, () => {});

    await provider.playSlide("/presentations/deck.pptx", toSlideIndex(0));

    expect(runAppleScriptJson).toHaveBeenCalledWith("play-slide.applescript", [
      "1",
      "/presentations/deck.pptx",
    ]);
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

describe("MacPptProvider.convertPptx", () => {
  it("keeps each slide's own index when only some slides exported", async () => {
    const provider = new MacPptProvider();
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
  it("names the 1-based slide number in the batch the macro reads", async () => {
    const provider = new MacPptProvider();
    let params = "";
    spyOnAppleScriptJson(provider, () => {
      params = fs.readFileSync(officeContainerPath("insert_audio_params.txt"), "utf8");
    });

    await provider.insertAudio("/presentations/deck.pptx", [
      { slideIndex: toSlideIndex(0), sectionIndex: 0, audioData: new Uint8Array([1]) },
      { slideIndex: toSlideIndex(2), sectionIndex: 1, audioData: new Uint8Array([2]) },
    ]);

    expect(
      params
        .trimEnd()
        .split("\n")
        .map((line) => line.split("|")[1]),
    ).toEqual(["1", "3"]);
  });
});

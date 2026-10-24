import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { FIRST_SLIDE_INDEX, slideIndexFromOneBased } from "../../shared/slides/slideCoordinates.js";
import { MacPptProvider } from "../../electron/platform/MacPptProvider.js";
import {
  CLEAN_SLIDE,
  describePptProviderContract,
  openHandBuiltDeckCopy,
  type PptProviderHarness,
  slideNarration,
} from "./pptProviderContract.js";
import {
  inspectPresentation,
  presentationDifferences,
  type InspectedSlide,
} from "./presentationInspector.js";

vi.mock("electron", async () => {
  const nodeOs = await import("node:os");
  const { fileURLToPath: toPath } = await import("node:url");
  return {
    app: {
      isPackaged: false,
      getAppPath: () => toPath(new URL("../..", import.meta.url)),
      getPath: (name: string) => (name === "home" ? nodeOs.homedir() : nodeOs.tmpdir()),
    },
    BrowserWindow: { getAllWindows: () => [] },
  };
});

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const OFFICE_CONTAINER = path.join(os.homedir(), "Library/Group Containers/UBF8T346G9.Office");
const ADD_IN = path.join(REPO, "electron/scripts/ppt-tools.ppam");
const FADED_AUDIO_SLIDE = slideIndexFromOneBased(4);

async function osascript(args: string[]): Promise<string> {
  const { stdout } = await run("osascript", args, { timeout: 120_000 });
  return stdout.trim();
}

async function openInPowerPoint(filePath: string): Promise<void> {
  await osascript([
    "-e",
    "on run argv",
    "-e",
    'tell application "Microsoft PowerPoint" to open (POSIX file (item 1 of argv))',
    "-e",
    "end run",
    filePath,
  ]);
}

async function closeInPowerPoint(filePath: string): Promise<void> {
  await osascript([
    path.join(REPO, "electron/scripts/close-presentation.applescript"),
    filePath,
    "discard",
  ]);
}

async function isOpenInPowerPoint(filePath: string): Promise<boolean> {
  const open = await osascript([
    "-e",
    "on run argv",
    "-e",
    'tell application "Microsoft PowerPoint" to return (full name of presentations) contains (item 1 of argv)',
    "-e",
    "end run",
    filePath,
  ]);
  return open === "true";
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Fails the run, never skips it, when Mac PowerPoint cannot run the native cases. */
async function preflight(provider: MacPptProvider, runDir: string): Promise<void> {
  try {
    await osascript(["-e", 'tell application "Microsoft PowerPoint" to get version']);
  } catch (error) {
    throw new Error(
      `PowerPoint did not answer AppleScript (${message(error)}). Install PowerPoint for Mac and allow this terminal to control it in System Settings > Privacy & Security > Automation.`,
      { cause: error },
    );
  }

  try {
    fs.mkdirSync(runDir, { recursive: true });
    const probe = path.join(OFFICE_CONTAINER, `power-narrator-native-probe-${randomUUID()}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe);
  } catch (error) {
    throw new Error(
      `The Office group container ${OFFICE_CONTAINER} is not writable (${message(error)}). Run the native tests outside any sandbox, and allow the app running them to access other apps' data, or give it Full Disk Access, in System Settings > Privacy & Security.`,
      { cause: error },
    );
  }

  const deck = path.join(runDir, `power-narrator-native-preflight-${randomUUID()}.pptx`);
  fs.copyFileSync(path.join(REPO, "tests/fixtures/hand-built-deck.pptx"), deck);
  try {
    await openInPowerPoint(deck);
    const read = await provider.readSlideNotes(deck, FIRST_SLIDE_INDEX);
    if (!read.success) {
      throw new Error(read.message);
    }
  } catch (error) {
    throw new Error(
      `The add-in's macros did not run (${message(error)}). In PowerPoint, choose Tools > PowerPoint Add-ins, add ${ADD_IN}, allow its macros and restart PowerPoint after every add-in change.`,
      { cause: error },
    );
  } finally {
    await closeInPowerPoint(deck).catch(() => undefined);
    fs.rmSync(deck, { force: true });
  }
}

/** Removes temporary output, keeping any deck whose closing or move failed. */
function tidy(runDir: string): void {
  if (!fs.existsSync(runDir)) {
    return;
  }
  for (const entry of fs.readdirSync(runDir)) {
    if (!entry.endsWith(".pptx")) {
      fs.rmSync(path.join(runDir, entry), { recursive: true, force: true });
    }
  }
  if (fs.readdirSync(runDir).length === 0) {
    fs.rmSync(runDir, { recursive: true });
  }
  const runsDir = path.dirname(runDir);
  if (fs.readdirSync(runsDir).length === 0) {
    fs.rmdirSync(runsDir);
  }
}

describe.skipIf(process.platform !== "darwin")("MacPptProvider against PowerPoint", () => {
  /** Inside the Office group container, so sandboxed PowerPoint opens files without asking. */
  const runDir = path.join(OFFICE_CONTAINER, "power-narrator-native", randomUUID());
  let provider: MacPptProvider;
  const harness: PptProviderHarness = {
    get provider() {
      return provider;
    },
    openPresentation: openInPowerPoint,
    closePresentation: closeInPowerPoint,
    isPresentationOpen: isOpenInPowerPoint,
    tempDir: () => runDir,
  };

  beforeAll(async () => {
    provider = new MacPptProvider();
    await preflight(provider, runDir);
  });
  afterAll(() => tidy(runDir));

  describePptProviderContract(harness);

  describe("reporting slide notes", () => {
    it("reports every slide's notes, with blank notes as empty", async () => {
      const deck = await openHandBuiltDeckCopy(harness);
      expect(await provider.saveSlideNarration(deck, slideNarration(CLEAN_SLIDE, "", []))).toEqual({
        success: true,
      });

      const all = await provider.readAllSlideNotes(deck);
      const one = await provider.readSlideNotes(deck, CLEAN_SLIDE);

      expect(all).toEqual({
        success: true,
        notes: new Map([
          [slideIndexFromOneBased(1), "First line of slide one.\nCafé — naïve “quotes” 日本語"],
          [slideIndexFromOneBased(2), "Slide two notes."],
          [slideIndexFromOneBased(3), "Slide three notes."],
          [slideIndexFromOneBased(4), "Slide four notes."],
          [CLEAN_SLIDE, ""],
        ]),
      });
      expect(one).toEqual({ success: true, notes: "" });
    });

    type NotesPageLayout = "body first" | "no body";

    async function openDeckWithNotesPages(
      layouts: ReadonlyMap<number, NotesPageLayout>,
    ): Promise<string> {
      const entries = unzipSync(
        fs.readFileSync(path.join(REPO, "tests/fixtures/hand-built-deck.pptx")),
      );
      for (const [slideNumber, layout] of layouts) {
        const name = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
        const xml = strFromU8(entries[name]!);
        const shapes = xml.match(/<p:sp>.*?<\/p:sp>/g) ?? [];
        const [image, body, numberPlaceholder] = shapes;
        const rearranged =
          layout === "body first"
            ? [body!, image!, numberPlaceholder!]
            : [image!, numberPlaceholder!];
        const start = xml.indexOf(image!);
        const end = xml.indexOf(numberPlaceholder!) + numberPlaceholder!.length;
        entries[name] = strToU8(xml.slice(0, start) + rearranged.join("") + xml.slice(end));
      }
      const deck = path.join(runDir, `power-narrator-native-${randomUUID()}.pptx`);
      fs.writeFileSync(deck, zipSync(entries));
      onTestFinished(async () => {
        await closeInPowerPoint(deck);
        fs.rmSync(deck, { force: true });
      });
      await openInPowerPoint(deck);
      return deck;
    }

    it("reads the notes body placeholder wherever it sits on the notes page, and a page without one as empty", async () => {
      const deck = await openDeckWithNotesPages(
        new Map([
          [2, "body first"],
          [3, "no body"],
        ]),
      );

      const all = await provider.readAllSlideNotes(deck);

      if (!all.success) {
        throw new Error(all.message);
      }
      expect(all.notes.get(slideIndexFromOneBased(2))).toBe("Slide two notes.");
      expect(all.notes.get(slideIndexFromOneBased(3))).toBe("");
    });

    it("saves notes into the body placeholder wherever it sits on the notes page", async () => {
      const deck = await openDeckWithNotesPages(new Map([[5, "body first"]]));

      expect(
        await provider.saveSlideNarration(
          deck,
          slideNarration(CLEAN_SLIDE, "Rewritten notes.", []),
        ),
      ).toEqual({ success: true });
      expect(await provider.readSlideNotes(deck, CLEAN_SLIDE)).toEqual({
        success: true,
        notes: "Rewritten notes.",
      });
    });

    it("refuses to save notes for a notes page without a body placeholder", async () => {
      const deck = await openDeckWithNotesPages(new Map([[5, "no body"]]));

      const saved = await provider.saveSlideNarration(
        deck,
        slideNarration(CLEAN_SLIDE, "Rewritten notes.", []),
      );

      if (saved.success) {
        throw new Error("Expected the save to fail");
      }
      expect(saved.saved).toBe("nothing");
      expect(saved.message).toContain("Slide 5 has no notes placeholder.");
    });

    it("reports a slide the presentation does not have as an error rather than a dialog", async () => {
      const deck = await openHandBuiltDeckCopy(harness);

      await expect(provider.readSlideNotes(deck, slideIndexFromOneBased(99))).resolves.toEqual({
        success: false,
        message: "Invalid slide number: 99",
      });
    });
  });

  describe("refusing a save the add-in cannot make without losing the audio's setup", () => {
    it("saves nothing over slide 4's faded section audio, says so, and a later save of another slide keeps slide 4 as it was", async () => {
      const deck = await openHandBuiltDeckCopy(harness);
      const before = inspectPresentation(deck);
      const untouched = (slides: InspectedSlide[]) =>
        slides.filter((_, slideIndex) => slideIndex !== CLEAN_SLIDE);

      const saved = await provider.saveSlideNarration(
        deck,
        slideNarration(FADED_AUDIO_SLIDE, "Replaced notes.", [
          { clip: "section-1.mp3", playAcrossSlides: true },
        ]),
      );
      expect(saved).toMatchObject({ success: false, saved: "nothing" });
      expect(presentationDifferences(before, inspectPresentation(deck))).toEqual([]);

      const cleanSaved = await provider.saveSlideNarration(
        deck,
        slideNarration(CLEAN_SLIDE, "Clean notes.", [
          { clip: "section-2.mp3", playAcrossSlides: false },
        ]),
      );
      expect(cleanSaved).toEqual({ success: true });
      await harness.closePresentation(deck);

      expect(
        presentationDifferences(
          { slides: untouched(before.slides) },
          { slides: untouched(inspectPresentation(deck).slides) },
        ),
      ).toEqual([]);
    });
  });
});

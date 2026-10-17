import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, vi } from "vitest";
import { FIRST_SLIDE_INDEX } from "../../shared/slides/slideCoordinates.js";
import { MacPptProvider } from "../../electron/platform/MacPptProvider.js";
import { describePptProviderContract, type PptProviderHarness } from "./pptProviderContract.js";

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

/** Removes what the run made, except the decks of failed cases. */
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
}

describe.skipIf(process.platform !== "darwin")("MacPptProvider against PowerPoint", () => {
  /** Inside the Office group container, so sandboxed PowerPoint opens files without asking. */
  const runDir = path.join(OFFICE_CONTAINER, "power-narrator-native", randomUUID());
  const provider = new MacPptProvider();
  const harness: PptProviderHarness = {
    provider,
    openPresentation: openInPowerPoint,
    closePresentation: closeInPowerPoint,
    tempDir: () => runDir,
  };

  beforeAll(() => preflight(provider, runDir));
  afterAll(() => tidy(runDir));

  describePptProviderContract(harness);
});

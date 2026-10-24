import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSlidesWithPaths } from "../../electron/platform/helpers.js";
import { slideIndexFromOneBased } from "../../shared/slides/slideCoordinates.js";

vi.mock("electron", () => ({ app: {} }));

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("../..", import.meta.url));

describe.skipIf(process.platform !== "darwin")("slide image export while switching decks", () => {
  let runDir: string;
  let target: string;
  let other: string;
  let harness: string;

  beforeAll(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-deck-switch-"));
    target = path.join(runDir, "target.pptx");
    other = path.join(runDir, "other.pptx");
    fs.copyFileSync(path.join(REPO, "tests/fixtures/hand-built-deck.pptx"), target);
    // Use two slides from a copy of the real deck so following the active deck
    // changes both the manifest length and the images it contains.
    const entries = unzipSync(fs.readFileSync(target));
    let slideCount = 0;
    entries["ppt/presentation.xml"] = strToU8(
      strFromU8(entries["ppt/presentation.xml"]!).replace(/<p:sldId\b[^>]*\/>/g, (slide) =>
        ++slideCount <= 2 ? slide : "",
      ),
    );
    fs.writeFileSync(other, zipSync(entries));

    // Inherit the production exporter and inject the user's window switch at
    // deterministic boundaries. Its run handler, count and image export are real.
    const exporter = fs
      .readFileSync(path.join(REPO, "electron/scripts/export-slide-images.applescript"), "utf8")
      .replace("use scripting additions", "");
    harness = path.join(runDir, "switch-decks.applescript");
    fs.writeFileSync(
      harness,
      `use scripting additions
script exporter
${exporter}
end script
script switchingExporter
    property parent : exporter
    property otherPath : ""
    property switchBeforeCount : false
    property exportInBackground : false
    on locateOrOpenPresentation(inputPath)
        set pres to continue locateOrOpenPresentation(inputPath)
        if my switchBeforeCount then my switchDeck()
        return pres
    end locateOrOpenPresentation
    on exportSlideToPng(pres, slideNumber, slidesDir, slidesHFS, exportToken)
        set imagePath to continue exportSlideToPng(pres, slideNumber, slidesDir, slidesHFS, exportToken)
        if slideNumber is 1 and not my switchBeforeCount then my switchDeck()
        return imagePath
    end exportSlideToPng
    on switchDeck()
        tell application "Microsoft PowerPoint" to open (POSIX file (my otherPath))
        if my exportInBackground then tell application "Finder" to activate
    end switchDeck
end script
on run argv
    set switchingExporter's otherPath to item 3 of argv
    set switchingExporter's switchBeforeCount to (item 4 of argv is "before-count")
    set switchingExporter's exportInBackground to (item 4 of argv is "in-background")
    tell application "Microsoft PowerPoint"
        open (POSIX file (item 3 of argv))
        open (POSIX file (item 1 of argv))
    end tell
    return run script switchingExporter with parameters {item 1 of argv, item 2 of argv}
end run
`,
    );
  });

  afterAll(async () => {
    if (!runDir) return;
    for (const deck of [target, other]) {
      await run("osascript", [
        path.join(REPO, "electron/scripts/close-presentation.applescript"),
        deck,
        "discard",
      ]);
    }
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it.each(["before-count", "during-export", "in-background"])(
    "keeps all five target slides and their images when switching %s",
    async (timing) => {
      const expectedDir = path.join(runDir, `expected-${timing}`);
      const outputDir = path.join(runDir, timing);
      const exported = async (script: string, args: string[]) => {
        const { stdout } = await run("osascript", [script, ...args]);
        const result = JSON.parse(stdout) as {
          success: boolean;
          message?: string;
          data: { manifestPath: string };
        };
        expect(result).toMatchObject({ success: true });
        return JSON.parse(fs.readFileSync(result.data.manifestPath, "utf8")) as Array<{
          slideNumber: number;
          image: string;
        }>;
      };
      const expected = await exported(
        path.join(REPO, "electron/scripts/export-slide-images.applescript"),
        [target, expectedDir],
      );
      const actual = await exported(harness, [target, outputDir, other, timing]);

      expect(actual.map(({ slideNumber }) => slideNumber)).toEqual([1, 2, 3, 4, 5]);
      // The viewer drops entries with no image. Check its final slide count as
      // well as the manifest, which can still contain five entries after failures.
      const visibleSlides = buildSlidesWithPaths(
        actual.map(({ slideNumber, image }) => ({
          slideIndex: slideIndexFromOneBased(slideNumber),
          image,
          notes: "",
          sectionsPlayingAcrossSlides: new Set<number>(),
        })),
        outputDir,
      );
      expect(visibleSlides).toHaveLength(5);
      const imageDigest = (filePath: string) =>
        createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      for (const [i, slide] of actual.entries()) {
        expect(imageDigest(path.join(outputDir, slide.image))).toEqual(
          imageDigest(path.join(expectedDir, expected[i]!.image)),
        );
      }
    },
  );
});

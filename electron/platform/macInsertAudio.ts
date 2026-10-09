import { slideNumberOf } from "../../shared/slides/slideCoordinates.js";
import { buildPptAudioShapeName } from "./helpers.js";
import { playsAcrossSlides } from "./sectionAudioPlayback.js";
import type { BasicPptResult, SlideAudioEntry } from "./types.js";

export type StagedSlideAudio = {
  entry: SlideAudioEntry;
  audioPath: string;
};

/** PowerPoint's own span when its Play Across Slides checkbox is ticked. */
const PLAY_ACROSS_SLIDES_SPAN = 999;

/**
 * The InsertAudio macro reads a `presentation|result` header, then one
 * `slideNumber|audioPath|playAcrossSlides` line per section audio, the flag
 * written as 1 or 0. New per-section fields are appended to the section line.
 */
export function formatInsertAudioParams(
  filePath: string,
  resultPath: string,
  stagedAudio: readonly StagedSlideAudio[],
): string {
  const sectionLines = stagedAudio.map(
    ({ entry, audioPath }) =>
      `${slideNumberOf(entry.slideIndex)}|${audioPath}|${entry.playAcrossSlides ? 1 : 0}\n`,
  );
  return `${filePath}|${resultPath}\n${sectionLines.join("")}`;
}

/**
 * Whether the playback PowerPoint read back from the inserted audio, as
 * `stopAfterSlides|playOnEntry|pauseAnimation` with 1 or 0 flags, is the choice
 * that was requested.
 */
function appliedPlayback(
  [stopAfterSlides, playOnEntry, pauseAnimation]: readonly string[],
  playAcrossSlides: boolean,
): boolean {
  if (!/^-?\d+$/.test(stopAfterSlides ?? "")) {
    return false;
  }
  return playAcrossSlides
    ? Number(stopAfterSlides) === PLAY_ACROSS_SLIDES_SPAN &&
        playOnEntry === "1" &&
        pauseAnimation === "0"
    : !playsAcrossSlides(Number(stopAfterSlides));
}

/**
 * Checks the macro's report against the request. The report holds
 * `inserted|slideNumber|shapeName|stopAfterSlides|playOnEntry|pauseAnimation`
 * per section audio, `slide|slideNumber|names`
 * listing the section audio left on each saved slide, `error|message` on
 * failure, and a final `done`.
 */
export function checkInsertAudioReport(
  report: string | undefined,
  slidesAudio: readonly SlideAudioEntry[],
): BasicPptResult {
  if (report === undefined) {
    return fail("PowerPoint did not report the result of inserting audio.");
  }

  const records = report
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));

  const error = records.find(([kind]) => kind === "error");
  if (error) {
    return fail(error.slice(1).join("|") || "PowerPoint failed to insert audio.");
  }
  if (!records.some(([kind]) => kind === "done")) {
    return fail("PowerPoint did not finish inserting audio.");
  }

  const inserted = new Map(
    records
      .filter(([kind]) => kind === "inserted")
      .map((record) => [`${record[1]}|${record[2]}`, record]),
  );
  const expectedBySlide = new Map<number, string[]>();
  for (const entry of slidesAudio) {
    const slideNumber = slideNumberOf(entry.slideIndex);
    const shapeName = buildPptAudioShapeName(entry.sectionIndex);
    const record = inserted.get(`${slideNumber}|${shapeName}`);
    if (!record) {
      return fail(`PowerPoint did not confirm ${shapeName} on slide ${slideNumber}.`);
    }
    if (!appliedPlayback(record.slice(3), entry.playAcrossSlides)) {
      return fail(`PowerPoint did not apply the playback of ${shapeName} on slide ${slideNumber}.`);
    }
    expectedBySlide.set(slideNumber, [...(expectedBySlide.get(slideNumber) ?? []), shapeName]);
  }

  const remainingBySlide = new Map(
    records
      .filter(([kind]) => kind === "slide")
      .map(([, slideNumber, names]) => [Number(slideNumber), names ? names.split(",") : []]),
  );
  for (const [slideNumber, expected] of expectedBySlide) {
    const remaining = remainingBySlide.get(slideNumber);
    if (remaining === undefined) {
      return fail(`PowerPoint did not report the section audio left on slide ${slideNumber}.`);
    }
    if (remaining.toSorted().join(",") !== expected.toSorted().join(",")) {
      return fail(
        `Section audio on slide ${slideNumber} is ${remaining.join(",") || "missing"} instead of ${expected.join(",")}.`,
      );
    }
  }

  return { success: true };
}

function fail(message: string): BasicPptResult {
  return { success: false, message };
}

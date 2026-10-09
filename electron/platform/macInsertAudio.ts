import { slideNumberOf } from "../../shared/slides/slideCoordinates.js";
import { buildPptAudioShapeName } from "./helpers.js";
import type { BasicPptResult, SlideAudioEntry } from "./types.js";

export type StagedSlideAudio = {
  entry: SlideAudioEntry;
  audioPath: string;
};

/**
 * The InsertAudio macro reads a `presentation|result` header, then one
 * `slideNumber|audioPath` line per section audio. New per-section fields are
 * appended to the section line.
 */
export function formatInsertAudioParams(
  filePath: string,
  resultPath: string,
  stagedAudio: readonly StagedSlideAudio[],
): string {
  const sectionLines = stagedAudio.map(
    ({ entry, audioPath }) => `${slideNumberOf(entry.slideIndex)}|${audioPath}\n`,
  );
  return `${filePath}|${resultPath}\n${sectionLines.join("")}`;
}

/**
 * Checks the macro's report against the request. The report holds
 * `inserted|slideNumber|shapeName` per section audio, `slide|slideNumber|names`
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
    if (!inserted.has(`${slideNumber}|${shapeName}`)) {
      return fail(`PowerPoint did not confirm ${shapeName} on slide ${slideNumber}.`);
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

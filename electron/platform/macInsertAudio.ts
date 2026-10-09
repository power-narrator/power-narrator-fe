import { slideNumberOf, type SlideNumber } from "../../shared/slides/slideCoordinates.js";
import { buildPptAudioShapeName } from "./helpers.js";
import { checkSectionAudioLeft, fail, isIntegerText, readAudioMacroReport } from "./macroReport.js";
import { playsAcrossSlides } from "./sectionAudioPlayback.js";
import type { BasicPptResult, SlideAudioEntry } from "./types.js";

export type StagedSlideAudio = {
  entry: SlideAudioEntry;
  audioPath: string;
};

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
  if (!isIntegerText(stopAfterSlides ?? "")) {
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
  const read = readAudioMacroReport(report, "inserting audio");
  if (!read.success) {
    return read;
  }

  const inserted = new Map(
    read.records
      .filter(([kind]) => kind === "inserted")
      .map((record) => [`${record[1]}|${record[2]}`, record]),
  );
  const expectedBySlide = new Map<SlideNumber, string[]>();
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

  return checkSectionAudioLeft(read.sectionAudioLeft, expectedBySlide);
}

/**
 * Checks the RemoveAudio macro's report, which lists the section audio left on
 * each requested slide as `slide|slideNumber|names`, `error|message` on
 * failure, and a final `done`. Every requested slide must be left without
 * section audio.
 */
export function checkRemoveAudioReport(
  report: string | undefined,
  slideNumbers: readonly SlideNumber[],
): BasicPptResult {
  const read = readAudioMacroReport(report, "removing audio");
  if (!read.success) {
    return read;
  }

  return checkSectionAudioLeft(
    read.sectionAudioLeft,
    new Map(slideNumbers.map((slideNumber) => [slideNumber, []])),
  );
}

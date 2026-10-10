import { slideNumberOf, type SlideNumber } from "../../shared/slides/slideCoordinates.js";
import { buildPptAudioShapeName } from "./helpers.js";
import {
  checkSectionAudioBySlide,
  fail,
  isIntegerText,
  readAudioMacroReport,
} from "./macroReport.js";
import { playsAcrossSlides } from "./sectionAudioPlayback.js";
import type { BasicPptResult, SlideAudioEntry } from "./types.js";

export type StagedSlideAudio = {
  entry: SlideAudioEntry;
  audioPath: string;
};

/** PowerPoint's Play Across Slides checkbox uses 999 when enabled and 0 when disabled. */
const PLAY_ACROSS_SLIDES_SPAN = 999;

/** Input to the InsertAudio macro, which parses by position: append new per-section fields. */
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

/** Each `inserted` record is `inserted|slideNumber|shapeName|stopAfterSlides|playOnEntry|pauseAnimation`. */
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

  return checkSectionAudioBySlide(read.sectionAudioBySlide, expectedBySlide);
}

export function checkRemoveAudioReport(
  report: string | undefined,
  slideNumbers: readonly SlideNumber[],
): BasicPptResult {
  const read = readAudioMacroReport(report, "removing audio");
  if (!read.success) {
    return read;
  }

  return checkSectionAudioBySlide(
    read.sectionAudioBySlide,
    new Map(slideNumbers.map((slideNumber) => [slideNumber, []])),
  );
}

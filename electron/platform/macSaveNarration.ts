import { slideNumberOf, type SlideNumber } from "../../shared/slides/slideCoordinates.js";
import { buildPptAudioShapeName } from "./helpers.js";
import {
  checkSectionAudioBySlide,
  fail,
  readAudioMacroReport,
  readPlayAcrossSlidesCheckbox,
  reportLines,
} from "./macroReport.js";
import type { BasicPptResult, SlideAudioEntry, SlideNotesEntry } from "./types.js";

export type StagedSlideAudio = {
  entry: SlideAudioEntry;
  audioPath: string;
};

export type NarrationSaveAction = "saving the slide" | "removing audio";

/**
 * Input to the SaveNarration macro, which parses by position: append new per-section fields.
 * Without a notes path the macro leaves the notes alone.
 */
export function formatSaveNarrationParams(
  filePath: string,
  resultPath: string,
  notesPath: string | undefined,
  slideNumbers: readonly SlideNumber[],
  stagedAudio: readonly StagedSlideAudio[],
): string {
  const sectionLines = stagedAudio.map(
    ({ entry, audioPath }) =>
      `${slideNumberOf(entry.slideIndex)}|${audioPath}|${entry.playAcrossSlides ? 1 : 0}\n`,
  );
  return `${filePath}|${resultPath}|${notesPath ?? ""}|${slideNumbers.join(",")}\n${sectionLines.join("")}`;
}

export function formatNotesData(slides: readonly SlideNotesEntry[]): string {
  return slides
    .map(
      (slide) =>
        `###SLIDE_START### ${slideNumberOf(slide.slideIndex)}\n${slide.notes}\n###SLIDE_END###\n`,
    )
    .join("");
}

/**
 * `editing` follows the baseline save; `saved` follows the final save. The macro
 * creates its report before changing anything, so a missing report means no mutation.
 * An unfinished report after a failed call is uncertain: the macro may still be running.
 */
export type NarrationSavePhase = "unchanged" | "editing" | "saved" | "unknown";

export function narrationSavePhase(
  report: string | undefined,
  macroReturned: boolean,
): NarrationSavePhase {
  if (report === undefined) {
    return "unchanged";
  }
  const kinds = new Set(reportLines(report).map((line) => line.split("|")[0]));
  if (kinds.has("saved")) {
    return "saved";
  }
  if (!macroReturned && !kinds.has("done") && !kinds.has("error")) {
    return "unknown";
  }
  return kinds.has("editing") ? "editing" : "unchanged";
}

export function checkSaveNarrationReport(
  report: string | undefined,
  action: NarrationSaveAction,
  slideNumbers: readonly SlideNumber[],
  slidesAudio: readonly SlideAudioEntry[],
): BasicPptResult {
  const read = readAudioMacroReport(report, action);
  if (!read.success) {
    return read;
  }
  if (narrationSavePhase(report, true) !== "saved") {
    return fail(`PowerPoint did not save the presentation while ${action}.`);
  }

  const inserted = new Map(
    read.records
      .filter(([kind]) => kind === "inserted")
      .map((record) => [`${record[1]}|${record[2]}`, record]),
  );
  const expectedBySlide = new Map<SlideNumber, string[]>(
    slideNumbers.map((slideNumber) => [slideNumber, []]),
  );
  for (const entry of slidesAudio) {
    const slideNumber = slideNumberOf(entry.slideIndex);
    const shapeName = buildPptAudioShapeName(entry.sectionIndex);
    const record = inserted.get(`${slideNumber}|${shapeName}`);
    if (!record) {
      return fail(`PowerPoint did not confirm ${shapeName} on slide ${slideNumber}.`);
    }
    const playback = readPlayAcrossSlidesCheckbox(record.slice(3), shapeName, slideNumber);
    if (!playback.success) {
      return playback;
    }
    if (playback.playsAcrossSlides !== entry.playAcrossSlides) {
      return fail(`PowerPoint did not apply the playback of ${shapeName} on slide ${slideNumber}.`);
    }
    expectedBySlide.set(slideNumber, [...(expectedBySlide.get(slideNumber) ?? []), shapeName]);
  }

  return checkSectionAudioBySlide(read.sectionAudioBySlide, expectedBySlide);
}

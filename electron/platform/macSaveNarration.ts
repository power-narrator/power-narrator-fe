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

/** What the macro is doing, for its messages. */
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
 * How far the macro got: `editing` once it saved the presentation as it was and
 * began changing it, `saved` once it saved those changes. `unknown` once it started
 * but did not return or finish its report: it may still be running, and its report
 * may not yet hold all it did. The macro opens its report before changing anything,
 * and its params are removed once it returns or fails to, so a missing report means
 * it changed nothing.
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

/**
 * Each `inserted` record is `inserted|slideNumber|shapeName|playsAcrossSlides`, the confirmed
 * checkbox as `true`/`false`. Every requested slide must be left with exactly its entries.
 * The macro confirms this before its final save; checking the report again catches an
 * add-in that does not match this app, after it saved.
 */
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

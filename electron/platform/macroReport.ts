import { toSlideNumber, type SlideNumber } from "../../shared/slides/slideCoordinates.js";
import type { BasicPptResult, ErrorResult, Result } from "./types.js";

export const reportLines = (report: string): string[] => report.split(/\r\n|\n|\r/);

export const isIntegerText = (text: string): boolean => /^-?\d+$/.test(text);

export function readSlideNumber(text: string): SlideNumber | undefined {
  return isIntegerText(text) && Number(text) >= 1 ? toSlideNumber(Number(text)) : undefined;
}

export function fail(message: string): ErrorResult {
  return { success: false, message };
}

const CHECKBOX_STATES: ReadonlyMap<string, boolean> = new Map([
  ["true", true],
  ["false", false],
]);

export function readPlayAcrossSlidesCheckbox(
  fields: readonly string[],
  shapeName: string,
  slideNumber: SlideNumber,
): Result<{ playsAcrossSlides: boolean }> {
  const [checkbox = "", ...extraFields] = fields;
  if (isIntegerText(checkbox)) {
    return fail(
      `PowerPoint reported a numeric playback for ${shapeName} on slide ${slideNumber}; the installed PowerPoint add-in does not match this app.`,
    );
  }
  const playsAcrossSlides = CHECKBOX_STATES.get(checkbox);
  if (playsAcrossSlides === undefined || extraFields.length > 0) {
    return fail(
      `PowerPoint reported an unreadable playback for ${shapeName} on slide ${slideNumber}.`,
    );
  }
  return { success: true, playsAcrossSlides };
}

export type AudioMacroReport = {
  records: string[][];
  sectionAudioBySlide: ReadonlyMap<SlideNumber, readonly string[]>;
};

export function readAudioMacroReport(
  report: string | undefined,
  action: string,
): Result<AudioMacroReport> {
  if (report === undefined) {
    return fail(`PowerPoint did not report the result of ${action}.`);
  }

  const records = reportLines(report)
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));

  const error = records.find(([kind]) => kind === "error");
  if (error) {
    return fail(error.slice(1).join("|") || `PowerPoint reported an error while ${action}.`);
  }
  if (!records.some(([kind]) => kind === "done")) {
    return fail(`PowerPoint did not finish ${action}.`);
  }

  const sectionAudioBySlide = new Map<SlideNumber, string[]>();
  for (const [kind, slideText = "", names] of records) {
    const slideNumber = readSlideNumber(slideText);
    if (kind === "slide" && slideNumber !== undefined) {
      sectionAudioBySlide.set(slideNumber, names ? names.split(",") : []);
    }
  }

  return { success: true, records, sectionAudioBySlide };
}

export function checkSectionAudioBySlide(
  sectionAudioBySlide: AudioMacroReport["sectionAudioBySlide"],
  expectedBySlide: ReadonlyMap<SlideNumber, readonly string[]>,
): BasicPptResult {
  for (const [slideNumber, expected] of expectedBySlide) {
    const actual = sectionAudioBySlide.get(slideNumber);
    if (actual === undefined) {
      return fail(`PowerPoint did not report the section audio left on slide ${slideNumber}.`);
    }
    if (actual.toSorted().join(",") !== expected.toSorted().join(",")) {
      return fail(
        `Section audio on slide ${slideNumber} is ${actual.join(",") || "missing"} instead of ${expected.join(",") || "none"}.`,
      );
    }
  }

  return { success: true };
}

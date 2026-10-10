import {
  slideIndexOf,
  type SlideIndex,
  type SlideNumber,
} from "../../shared/slides/slideCoordinates.js";
import type { Result } from "../../shared/types/result.js";
import { PPT_AUDIO_PREFIX } from "./helpers.js";
import { isIntegerText, readSlideNumber, reportLines } from "./macroReport.js";
import type { SectionsPlayingAcrossSlides } from "./types.js";

export type SectionAudioPlaybackResult = Result<{
  playback: ReadonlyMap<SlideIndex, SectionsPlayingAcrossSlides>;
}>;

const SLIDE_START = "###SLIDE_START### ";
const SLIDE_END = "###SLIDE_END###";
const EXPORT_COMPLETE = "###EXPORT_COMPLETE###";
const ERROR = "###ERROR### ";
const SECTION_AUDIO_NAME = new RegExp(`^${PPT_AUDIO_PREFIX}_([1-9]\\d*)$`);

/**
 * The ribbon writes 0 when Play Across Slides is off and 999 when on. A span of
 * 1 is untested and most likely stops at the current slide, so it reads as off.
 */
export const playsAcrossSlides = (stopAfterSlides: number): boolean => stopAfterSlides > 1;

export const sectionsPlayingAcrossSlidesOn = (
  playback: ReadonlyMap<SlideIndex, SectionsPlayingAcrossSlides>,
  slideIndex: SlideIndex,
): SectionsPlayingAcrossSlides => playback.get(slideIndex) ?? new Set();

export function parseSectionAudioPlaybackReport(
  report: string,
  requestedSlides: readonly SlideNumber[],
): SectionAudioPlaybackResult {
  const lines = reportLines(report);
  const error = lines.find((line) => line.startsWith(ERROR));
  if (error !== undefined) {
    return { success: false, message: error.slice(ERROR.length) };
  }
  if (!lines.includes(EXPORT_COMPLETE)) {
    return {
      success: false,
      message: "PowerPoint did not finish reporting section audio playback.",
    };
  }

  const reported = new Map<SlideNumber, Set<number>>();
  let slideNumber: SlideNumber | null = null;
  let namesOnSlide = new Set<string>();

  for (const line of lines) {
    if (line.startsWith(SLIDE_START)) {
      slideNumber = readSlideNumber(line.slice(SLIDE_START.length)) ?? null;
      namesOnSlide = new Set();
      if (slideNumber !== null) {
        reported.set(slideNumber, new Set());
      }
      continue;
    }
    if (line === SLIDE_END) {
      slideNumber = null;
      continue;
    }
    if (slideNumber === null || line === "") {
      continue;
    }

    const [name = "", stopAfterSlides = ""] = line.split("\t");
    const ordinal = SECTION_AUDIO_NAME.exec(name)?.[1];
    if (ordinal === undefined) {
      return {
        success: false,
        message: `PowerPoint reported an unexpected shape ${name} on slide ${slideNumber}.`,
      };
    }
    if (namesOnSlide.has(name)) {
      return {
        success: false,
        message: `Slide ${slideNumber} has more than one shape named ${name}.`,
      };
    }
    namesOnSlide.add(name);
    if (!isIntegerText(stopAfterSlides)) {
      return {
        success: false,
        message: `PowerPoint reported an unreadable playback for ${name} on slide ${slideNumber}.`,
      };
    }
    if (playsAcrossSlides(Number(stopAfterSlides))) {
      reported.get(slideNumber)?.add(Number(ordinal) - 1);
    }
  }

  const playback = new Map<SlideIndex, SectionsPlayingAcrossSlides>();
  for (const requested of requestedSlides) {
    const sections = reported.get(requested);
    if (sections === undefined) {
      return {
        success: false,
        message: `PowerPoint did not report section audio playback for slide ${requested}.`,
      };
    }
    playback.set(slideIndexOf(requested), sections);
  }

  return { success: true, playback };
}

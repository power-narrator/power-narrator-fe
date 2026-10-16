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

const CHECKBOX_STATES: ReadonlyMap<string, boolean> = new Map([
  ["true", true],
  ["false", false],
]);

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

  const unfinishedSlide = (slide: SlideNumber): SectionAudioPlaybackResult => ({
    success: false,
    message: `PowerPoint did not finish reporting section audio playback for slide ${slide}.`,
  });

  for (const line of lines) {
    if (line === EXPORT_COMPLETE) {
      if (slideNumber !== null) {
        return unfinishedSlide(slideNumber);
      }
      break;
    }
    if (line.startsWith(SLIDE_START)) {
      if (slideNumber !== null) {
        return unfinishedSlide(slideNumber);
      }
      const slideText = line.slice(SLIDE_START.length);
      const started = readSlideNumber(slideText);
      if (started === undefined) {
        return { success: false, message: `PowerPoint reported an unreadable slide: ${slideText}` };
      }
      if (reported.has(started)) {
        return {
          success: false,
          message: `PowerPoint reported section audio playback for slide ${started} more than once.`,
        };
      }
      slideNumber = started;
      namesOnSlide = new Set();
      reported.set(slideNumber, new Set());
      continue;
    }
    if (line === "") {
      continue;
    }
    if (slideNumber === null) {
      return { success: false, message: `PowerPoint reported playback outside a slide: ${line}` };
    }
    if (line === SLIDE_END) {
      slideNumber = null;
      continue;
    }

    const [name = "", checkbox = "", ...extraFields] = line.split("\t");
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
    if (isIntegerText(checkbox)) {
      return {
        success: false,
        message: `PowerPoint reported a numeric playback for ${name} on slide ${slideNumber}; the installed PowerPoint add-in does not match this app.`,
      };
    }
    const playsAcrossSlides = CHECKBOX_STATES.get(checkbox);
    if (playsAcrossSlides === undefined || extraFields.length > 0) {
      return {
        success: false,
        message: `PowerPoint reported an unreadable playback for ${name} on slide ${slideNumber}.`,
      };
    }
    if (playsAcrossSlides) {
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

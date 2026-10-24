import {
  slideIndexOf,
  toSlideNumber,
  type SlideIndex,
  type SlideNumber,
} from "../../shared/slides/slideCoordinates.js";
import type { Result } from "../../shared/types/result.js";
import { fail, readSlideNumber, reportLines } from "./macroReport.js";
import type { SlideNotesMap } from "./types.js";

const SLIDE_COUNT = "###SLIDE_COUNT### ";
const SLIDE_START = "###SLIDE_START### ";
const SLIDE_END = "###SLIDE_END###";
const EXPORT_COMPLETE = "###EXPORT_COMPLETE###";
const ERROR = "###ERROR### ";

export type NotesReportResult = Result<{ notes: SlideNotesMap }>;

const unfinishedSlide = (slideNumber: SlideNumber) =>
  fail(`PowerPoint did not finish reporting the notes of slide ${slideNumber}.`);

/**
 * Reads a notes export, which must report every requested slide, or every slide
 * of the presentation when none are named.
 */
export function parseNotesReport(
  report: string,
  requestedSlides?: readonly SlideNumber[],
): NotesReportResult {
  const [header = "", ...lines] = reportLines(report);
  if (header.startsWith(ERROR)) {
    return fail(header.slice(ERROR.length));
  }

  const countText = header.startsWith(SLIDE_COUNT) ? header.slice(SLIDE_COUNT.length) : "";
  if (!/^\d+$/.test(countText)) {
    return fail("PowerPoint did not report how many slides the presentation has.");
  }
  const slideCount = Number(countText);

  const notes = new Map<SlideIndex, string>();
  let slide: { number: SlideNumber; lines: string[] } | null = null;
  let complete = false;

  for (const line of lines) {
    if (slide !== null) {
      if (line === SLIDE_END) {
        notes.set(slideIndexOf(slide.number), slide.lines.join("\n"));
        slide = null;
      } else if (line.startsWith(SLIDE_START) || line === EXPORT_COMPLETE) {
        return unfinishedSlide(slide.number);
      } else {
        slide.lines.push(line);
      }
      continue;
    }

    if (line === "") {
      continue;
    }
    if (line === EXPORT_COMPLETE && !complete) {
      complete = true;
      continue;
    }
    if (line.startsWith(SLIDE_START) && !complete) {
      const slideText = line.slice(SLIDE_START.length);
      const slideNumber = readSlideNumber(slideText);
      if (slideNumber === undefined) {
        return fail(`PowerPoint reported notes for an unreadable slide: ${slideText}`);
      }
      if (slideNumber > slideCount) {
        return fail(
          `PowerPoint reported notes for slide ${slideNumber} of a ${slideCount}-slide presentation.`,
        );
      }
      if (notes.has(slideIndexOf(slideNumber))) {
        return fail(`PowerPoint reported the notes of slide ${slideNumber} more than once.`);
      }
      slide = { number: slideNumber, lines: [] };
      continue;
    }
    return fail(`PowerPoint reported notes outside a slide: ${line}`);
  }

  if (slide !== null) {
    return unfinishedSlide(slide.number);
  }
  if (!complete) {
    return fail("PowerPoint did not finish reporting slide notes.");
  }

  const expectedSlides =
    requestedSlides ?? Array.from({ length: slideCount }, (_, i) => toSlideNumber(i + 1));
  const missing = expectedSlides.find((slideNumber) => !notes.has(slideIndexOf(slideNumber)));
  if (missing !== undefined) {
    return fail(`PowerPoint did not report the notes of slide ${missing}.`);
  }

  return { success: true, notes };
}

import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarratedSlideInput,
  NarratedSlideSaveRequest,
  SaveAllRunOutcome,
  SaveAllRunProgress,
  SaveAllRunResult,
} from "../../shared/types/narration.js";
import type { SlideAudioEntry } from "../platform/types.js";
import type { PptProvider } from "../platform/PptProvider.js";
import type { SlideIndex } from "../../shared/slides/slideCoordinates.js";
import { formatNarrationSections } from "../../shared/narration/NarrationSections.js";
import {
  NarrationPreparation,
  NarrationPreparationError,
  type PlannedNarrationSlide,
} from "./NarrationPreparation.js";

type SavePowerPoint = Pick<PptProvider, "saveNotes" | "insertAudio" | "removeAudio">;

/** A latch the run reads at each safe boundary; once requested it stays requested. */
export type SaveAllRunCancellation = { readonly requested: boolean };

const NEVER_CANCELLED: SaveAllRunCancellation = { requested: false };

export class NarratedPresentationSaver {
  constructor(
    private readonly narrationPreparation: NarrationPreparation,
    private readonly getPowerPoint: () => SavePowerPoint,
  ) {}

  /**
   * Commits one slide. Named separately from {@link savePresentation} because
   * the single-slide save is its own IPC channel with its own request shape.
   */
  async saveSlide(request: NarratedSlideSaveRequest): Promise<NarratedSaveResult> {
    const { filePath, ...slide } = request;
    const { outcome } = await this.savePresentation({ filePath, slides: [slide] });
    if (!outcome.success && outcome.stage === "cancelled") {
      throw new Error("A single-slide save has no cancellation.");
    }
    return outcome;
  }

  /**
   * A save-all run: one complete slide at a time, in request order. A slide is
   * written only once all of its sections have been synthesized, and no later
   * slide starts before it is saved.
   *
   * Cancellation is honoured before a slide starts generating and before its
   * save sequence starts; a slide already being saved finishes its writes.
   */
  async savePresentation(
    request: NarratedPresentationSaveRequest,
    onProgress?: (progress: SaveAllRunProgress) => void,
    cancellation: SaveAllRunCancellation = NEVER_CANCELLED,
  ): Promise<SaveAllRunResult> {
    const savedNoteSlides: SlideIndex[] = [];
    const finish = (outcome: SaveAllRunOutcome, failedSlideIndex?: SlideIndex): SaveAllRunResult =>
      failedSlideIndex === undefined
        ? { outcome, savedNoteSlides }
        : { outcome, savedNoteSlides, failedSlideIndex };

    let planned: PlannedNarrationSlide[];
    try {
      planned = await this.narrationPreparation.planSlides(request.slides);
    } catch (error: unknown) {
      return finish(preparationFailure(error));
    }

    let powerpoint: SavePowerPoint;
    try {
      powerpoint = this.getPowerPoint();
    } catch (error: unknown) {
      return finish(powerPointFailure(error, false));
    }

    const cancelled = { success: false, stage: "cancelled" } as const;
    for (const [completedSlides, plannedSlide] of planned.entries()) {
      if (cancellation.requested) {
        return finish(cancelled);
      }

      const report = (phase: SaveAllRunProgress["phase"]) =>
        onProgress?.({
          slideIndex: plannedSlide.slideIndex,
          completedSlides,
          totalSlides: planned.length,
          phase,
        });

      report("generating");
      let audio: SlideAudioEntry[];
      try {
        audio = await plannedSlide.synthesize();
      } catch (error: unknown) {
        return finish(preparationFailure(error), plannedSlide.slideIndex);
      }
      if (cancellation.requested) {
        return finish(cancelled);
      }

      report("saving");
      const saved = await this.commitSlide(
        powerpoint,
        request.filePath,
        request.slides[completedSlides]!,
        audio,
        () => savedNoteSlides.push(plannedSlide.slideIndex),
      );
      if (!saved.success) {
        return finish(saved, plannedSlide.slideIndex);
      }
    }

    return finish({ success: true });
  }

  /** Saves one slide's notes, then inserts its audio or removes stale audio. */
  private async commitSlide(
    powerpoint: SavePowerPoint,
    filePath: string,
    slide: NarratedSlideInput,
    audio: SlideAudioEntry[],
    notesSaved: () => void,
  ): Promise<NarratedSaveResult> {
    let notesResult;
    try {
      notesResult = await powerpoint.saveNotes(filePath, [
        {
          slideIndex: slide.slideIndex,
          // Raw note text exists only from here on: structured sections are
          // formatted immediately before PowerPoint takes them.
          notes: formatNarrationSections(slide.sections),
        },
      ]);
    } catch (error: unknown) {
      return powerPointFailure(error, false);
    }
    if (!notesResult.success) {
      return { success: false, stage: "powerpoint", partial: false, message: notesResult.message };
    }
    notesSaved();

    let audioResult;
    try {
      audioResult =
        audio.length > 0
          ? await powerpoint.insertAudio(filePath, audio)
          : await powerpoint.removeAudio(filePath, [slide.slideIndex]);
    } catch (error: unknown) {
      return powerPointFailure(error, true);
    }
    if (!audioResult.success) {
      return { success: false, stage: "powerpoint", partial: true, message: audioResult.message };
    }

    return { success: true };
  }
}

function preparationFailure(error: unknown): NarratedSaveResult {
  if (error instanceof NarrationPreparationError) {
    return { success: false, stage: error.stage, partial: false, message: error.message };
  }
  return {
    success: false,
    stage: "validation",
    partial: false,
    message: error instanceof Error ? error.message : "Unknown narration preparation error",
  };
}

function powerPointFailure(error: unknown, partial: boolean): NarratedSaveResult {
  return {
    success: false,
    stage: "powerpoint",
    partial,
    message: error instanceof Error ? error.message : "Unknown PowerPoint error",
  };
}

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

export class SaveAllRunCancellation {
  #requested = false;

  get requested(): boolean {
    return this.#requested;
  }

  request(): void {
    this.#requested = true;
  }
}

const NEVER_CANCELLED = new SaveAllRunCancellation();

type PreparedSave =
  | { ready: true; planned: PlannedNarrationSlide[]; powerpoint: SavePowerPoint }
  | { ready: false; failure: NarratedSaveResult };

type SynthesizedSlide =
  | { synthesized: true; audio: SlideAudioEntry[] }
  | { synthesized: false; failure: NarratedSaveResult };

export class NarratedPresentationSaver {
  constructor(
    private readonly narrationPreparation: NarrationPreparation,
    private readonly getPowerPoint: () => SavePowerPoint,
  ) {}

  async saveSlide(request: NarratedSlideSaveRequest): Promise<NarratedSaveResult> {
    const { filePath, ...slide } = request;
    const prepared = await this.prepare([slide]);
    if (!prepared.ready) {
      return prepared.failure;
    }

    const [planned] = prepared.planned;
    const synthesized = await synthesizeSlide(planned!);
    if (!synthesized.synthesized) {
      return synthesized.failure;
    }
    return commitSlide(prepared.powerpoint, filePath, planned!, synthesized.audio);
  }

  /**
   * Cancellation is honoured before a slide starts generating and before its
   * save sequence starts; a slide already being saved finishes its writes, and
   * the run then ends cancelled even when that slide was the last.
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
    const cancelled = { success: false, stage: "cancelled" } as const;

    const prepared = await this.prepare(request.slides);
    if (!prepared.ready) {
      return finish(prepared.failure);
    }
    const { planned, powerpoint } = prepared;
    const totalSlides = planned.length;

    for (const [completedSlides, slide] of planned.entries()) {
      if (cancellation.requested) {
        return finish(cancelled);
      }

      const report = (phase: SaveAllRunProgress["phase"]) =>
        onProgress?.({ slideIndex: slide.slideIndex, completedSlides, totalSlides, phase });

      report("generating");
      const synthesized = await synthesizeSlide(slide);
      if (!synthesized.synthesized) {
        return finish(synthesized.failure, slide.slideIndex);
      }
      if (cancellation.requested) {
        return finish(cancelled);
      }

      report("saving");
      const saved = await commitSlide(powerpoint, request.filePath, slide, synthesized.audio);
      if (saved.success || saved.partial) {
        savedNoteSlides.push(slide.slideIndex);
      }
      if (!saved.success) {
        return finish(saved, slide.slideIndex);
      }
    }

    const lastSlide = planned.at(-1);
    if (lastSlide) {
      onProgress?.({
        slideIndex: lastSlide.slideIndex,
        completedSlides: totalSlides,
        totalSlides,
        phase: "saving",
      });
    }
    return finish(cancellation.requested ? cancelled : { success: true });
  }

  private async prepare(slides: readonly NarratedSlideInput[]): Promise<PreparedSave> {
    let planned: PlannedNarrationSlide[];
    try {
      planned = await this.narrationPreparation.planSlides(slides);
    } catch (error: unknown) {
      return { ready: false, failure: preparationFailure(error) };
    }

    try {
      return { ready: true, planned, powerpoint: this.getPowerPoint() };
    } catch (error: unknown) {
      return { ready: false, failure: powerPointFailure(error, false) };
    }
  }
}

async function synthesizeSlide(slide: PlannedNarrationSlide): Promise<SynthesizedSlide> {
  try {
    return { synthesized: true, audio: await slide.synthesize() };
  } catch (error: unknown) {
    return { synthesized: false, failure: preparationFailure(error) };
  }
}

async function commitSlide(
  powerpoint: SavePowerPoint,
  filePath: string,
  slide: NarratedSlideInput,
  audio: SlideAudioEntry[],
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

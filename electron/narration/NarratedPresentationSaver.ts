import type {
  NarratedPresentationSaveRequest,
  NarrationPreparationProgress,
  NarratedSaveResult,
  NarratedSlideSaveRequest,
} from "../../shared/types/narration.js";
import type { PptProvider } from "../platform/PptProvider.js";
import { NarrationPreparation, NarrationPreparationError } from "./NarrationPreparation.js";

type SavePowerPoint = Pick<PptProvider, "saveNotes" | "insertAudio">;

export class NarratedPresentationSaver {
  constructor(
    private readonly narrationPreparation: NarrationPreparation,
    private readonly getPowerPoint: () => SavePowerPoint,
  ) {}

  saveSlide(request: NarratedSlideSaveRequest): Promise<NarratedSaveResult> {
    return this.savePresentation({
      filePath: request.filePath,
      slides: [{ slideIndex: request.slideIndex, notes: request.notes }],
    });
  }

  async savePresentation(
    request: NarratedPresentationSaveRequest,
    onProgress?: (progress: NarrationPreparationProgress) => void,
  ): Promise<NarratedSaveResult> {
    let audio;
    try {
      audio = await this.narrationPreparation.prepareBatch(request.slides, onProgress);
    } catch (error: unknown) {
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

    let powerpoint: SavePowerPoint;
    try {
      powerpoint = this.getPowerPoint();
    } catch (error: unknown) {
      return this.powerPointFailure(error, false);
    }

    let notesResult;
    try {
      notesResult = await powerpoint.saveNotes(
        request.filePath,
        request.slides.map((slide) => ({ index: slide.slideIndex, notes: slide.notes })),
      );
    } catch (error: unknown) {
      return this.powerPointFailure(error, false);
    }
    if (!notesResult.success) {
      return {
        success: false,
        stage: "powerpoint",
        partial: false,
        message: notesResult.message,
      };
    }

    let audioResult;
    try {
      audioResult = await powerpoint.insertAudio(request.filePath, audio);
    } catch (error: unknown) {
      return this.powerPointFailure(error, true);
    }
    if (!audioResult.success) {
      return {
        success: false,
        stage: "powerpoint",
        partial: true,
        message: audioResult.message,
      };
    }

    return { success: true };
  }

  private powerPointFailure(error: unknown, partial: boolean): NarratedSaveResult {
    return {
      success: false,
      stage: "powerpoint",
      partial,
      message: error instanceof Error ? error.message : "Unknown PowerPoint error",
    };
  }
}

import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import type { NativePlatformProvider, PptProvider } from "./PptProvider.js";
import {
  FIRST_SLIDE_INDEX,
  trySlideIndexFromOneBased,
  slideNumberOf,
  type SlideIndex,
} from "../../shared/slides/slideCoordinates.js";
import { getErrorMessage } from "./errors.js";
import {
  APP_NAME,
  buildSlidesWithPaths,
  buildPptAudioFileName,
  cleanupPaths,
  exportedPreviewImages,
  reloadedPreviewImage,
  resolveScriptPath,
} from "./helpers.js";
import {
  parseSectionAudioPlaybackReport,
  sectionsPlayingAcrossSlidesOn,
  type SectionAudioPlaybackResult,
} from "./sectionAudioPlayback.js";
import { parseNotesReport, type NotesReportResult } from "./notesReport.js";
import { completeSlideReload } from "./slideReload.js";
import {
  checkSaveNarrationReport,
  formatNotesData,
  formatSaveNarrationParams,
  narrationSavePhase,
  type NarrationSaveAction,
  type NarrationSavePhase,
  type StagedSlideAudio,
} from "./macSaveNarration.js";
import type {
  BasicPptResult,
  SectionsPlayingAcrossSlides,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideContentResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlideAudioEntry,
  SlideImageMap,
  SlideManifestEntry,
  SlideNarrationEntry,
  SlideNarrationSaveResult,
  SlideNotesEntry,
  SlideNotesMap,
  SlidePptResult,
  SlidesPptResult,
  VideoPptResult,
} from "./types.js";

type AppleScriptResult<T = Record<string, unknown>> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      message: string;
      data?: T;
    };

type MacroLaunch = {
  /** The app that was in front, set only when the launch brought PowerPoint in front of it. */
  previousApp?: string;
};

/**
 * Selecting audio needs the presentation's window to be PowerPoint's active window, which
 * PowerPoint switches to only while it is the frontmost app.
 */
type MacroWindow = "background" | "target-window";

type ClosedPresentation =
  | { closed: true; slideIndex: SlideIndex }
  | { closed: false; slideIndex: SlideIndex; message: string };

type NarrationSaveRequest = {
  action: NarrationSaveAction;
  slideIndices: readonly SlideIndex[];
  /** Notes to write; without them the notes are left alone. */
  notes?: readonly SlideNotesEntry[];
  /** The complete section audio of each requested slide; none removes it. */
  audio: readonly SlideAudioEntry[];
};

/** close-presentation.applescript prints this when no open presentation has the path. */
const NOT_OPEN = "not-open";

export class MacPptProvider implements PptProvider, NativePlatformProvider {
  constructor() {
    this.cleanup();
  }

  private getOfficeContainerPath(): string {
    return path.join(app.getPath("home"), "Library/Group Containers/UBF8T346G9.Office");
  }

  private mergeSlideData(
    images: SlideImageMap,
    notes: SlideNotesMap,
    playback: ReadonlyMap<SlideIndex, SectionsPlayingAcrossSlides>,
  ): SlideManifestEntry[] {
    return [...notes.keys()]
      .toSorted((a, b) => a - b)
      .map((slideIndex) => ({
        slideIndex,
        image: images.get(slideIndex)?.image || null,
        notes: notes.get(slideIndex) || "",
        sectionsPlayingAcrossSlides: sectionsPlayingAcrossSlidesOn(playback, slideIndex),
      }));
  }

  /** The manifest addresses slides by the 1-based number PowerPoint exports. */
  private readImageManifest(manifestPath: string): SlideImageMap {
    const slides = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Array<{
      slideNumber?: unknown;
      image?: string;
    }>;
    const images = new Map<SlideIndex, { image: string }>();

    for (const { slideNumber, image } of slides) {
      const slideIndex = trySlideIndexFromOneBased(slideNumber);
      if (slideIndex !== undefined) {
        images.set(slideIndex, { image: image || "" });
      }
    }

    return images;
  }

  private parseAppleScriptJson<T = Record<string, unknown>>(stdout: string): AppleScriptResult<T> {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { success: false, message: "AppleScript returned no output." };
    }

    try {
      const parsed = JSON.parse(trimmed) as AppleScriptResult<T>;
      if (parsed.success) {
        return { success: true, data: parsed.data };
      }

      return {
        success: false,
        message: parsed.message || "AppleScript reported failure.",
        data: parsed.data,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: `Failed to parse AppleScript JSON: ${getErrorMessage(error)}`,
      };
    }
  }

  private runAppleScriptJson<T = Record<string, unknown>>(
    scriptName: string,
    args: string[],
  ): Promise<AppleScriptResult<T>> {
    return new Promise((resolve) => {
      const scriptPath = resolveScriptPath(scriptName);
      const child = spawn("osascript", [scriptPath, ...args]);

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code: number) => {
        const parsed = this.parseAppleScriptJson<T>(stdout);
        if (parsed.success || stdout.trim()) {
          if (!parsed.success && stderr.trim()) {
            resolve({ success: false, message: stderr.trim() });
            return;
          }

          resolve(parsed);
          return;
        }

        if (code !== 0) {
          resolve({
            success: false,
            message: stderr.trim() || `AppleScript failed with code ${code}.`,
          });
          return;
        }

        resolve(parsed);
      });

      child.on("error", (error: Error) => {
        resolve({
          success: false,
          message: `Failed to start AppleScript: ${getErrorMessage(error)}`,
        });
      });
    });
  }

  private async triggerMacro(
    macroName: string,
    filePath: string,
    paramsFileName: string,
    params: string,
    window: MacroWindow = "background",
  ): Promise<AppleScriptResult<MacroLaunch>> {
    const paramsPath = path.join(this.getOfficeContainerPath(), paramsFileName);
    try {
      fs.writeFileSync(paramsPath, params, "utf8");
      return await this.runAppleScriptJson<MacroLaunch>(
        "trigger-macro.applescript",
        window === "target-window" ? [macroName, filePath, window] : [macroName, filePath],
      );
    } finally {
      cleanupPaths(paramsPath);
    }
  }

  /** Brings back `previousApp` unless the user has since moved away from PowerPoint. */
  private async restoreForeground(previousApp: string | undefined): Promise<void> {
    if (previousApp === undefined) {
      return;
    }
    try {
      const { stderr, code } = await this.runScript("restore-foreground.applescript", [
        previousApp,
      ]);
      if (code !== 0) {
        console.error("Failed to restore the frontmost app:", stderr.trim());
      }
    } catch (e) {
      console.error("Failed to restore the frontmost app:", e);
    }
  }

  private focusApp(): void {
    const [firstWindow] = BrowserWindow.getAllWindows();
    if (firstWindow) {
      firstWindow.show();
      firstWindow.focus();
    }
  }

  private cleanup(): void {
    try {
      const officeContainer = this.getOfficeContainerPath();
      const tempAudioDir = path.join(officeContainer, "TemporaryAudio");
      fs.rmSync(tempAudioDir, { recursive: true, force: true });
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  }

  closePresentation(filePath: string): Promise<SlideIndex> {
    return this.close(filePath, "save").then(({ slideIndex }) => slideIndex);
  }

  private async close(filePath: string, changes: "save" | "discard"): Promise<ClosedPresentation> {
    try {
      const { stdout, stderr, code } = await this.runScript("close-presentation.applescript", [
        filePath,
        changes,
      ]);
      const trimmed = stdout.trim();
      const slideNumber = trimmed === "" ? Number.NaN : Math.trunc(Number(trimmed));
      const slideIndex = trySlideIndexFromOneBased(slideNumber) ?? FIRST_SLIDE_INDEX;
      if (code !== 0) {
        return { closed: false, slideIndex, message: stderr.trim() || `exit code ${code}` };
      }
      if (trimmed === NOT_OPEN) {
        return { closed: false, slideIndex, message: "it is not open in PowerPoint" };
      }
      return { closed: true, slideIndex };
    } catch (e) {
      console.error("Failed to close presentation", e);
      return { closed: false, slideIndex: FIRST_SLIDE_INDEX, message: getErrorMessage(e) };
    }
  }

  async reopenPresentation(filePath: string, slideIndex: SlideIndex): Promise<void> {
    await this.reopen(filePath, slideIndex);
    this.focusApp();
  }

  private async reopen(filePath: string, slideIndex: SlideIndex): Promise<string | undefined> {
    let failure: string | undefined;
    try {
      const { stderr, code } = await this.runScript("reopen-presentation.applescript", [
        filePath,
        slideNumberOf(slideIndex).toString(),
      ]);
      if (code !== 0) {
        failure = stderr.trim() || `exit code ${code}`;
      }
    } catch (e) {
      console.error("Failed to reopen presentation", e);
      failure = getErrorMessage(e);
    }

    return failure;
  }

  private runScript(
    scriptName: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const child = spawn("osascript", [resolveScriptPath(scriptName), ...args]);
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code: number) => resolve({ stdout, stderr, code }));
      child.on("error", reject);
    });
  }

  async exportSlideImages(filePath: string, outputDir: string): Promise<ExportSlideImagesResult> {
    const tempDir = app.getPath("temp");
    fs.mkdirSync(path.join(tempDir, APP_NAME), { recursive: true });

    try {
      const scriptResult = await this.runAppleScriptJson<{ manifestPath: string }>(
        "export-slide-images.applescript",
        [filePath, outputDir],
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Image export failed." };
      }

      const manifestPath = scriptResult.data.manifestPath;

      const images = this.readImageManifest(manifestPath);
      return { success: true, images };
    } catch (err: unknown) {
      return { success: false, message: getErrorMessage(err) };
    }
  }

  async reloadSlideImage(
    filePath: string,
    slideIndex: SlideIndex,
    outputDir: string,
  ): Promise<ReloadSlideImageResult> {
    const slideNumber = slideNumberOf(slideIndex);

    try {
      const scriptResult = await this.runAppleScriptJson<{ image: string }>(
        "export-slide-images.applescript",
        [filePath, outputDir, slideNumber.toString()],
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Slide image export failed." };
      }

      const image = scriptResult.data.image;
      if (!image) {
        return {
          success: false,
          message: `Could not find exported image for slide ${slideNumber}`,
        };
      }

      return { success: true, image };
    } catch (err: unknown) {
      return { success: false, message: getErrorMessage(err) };
    }
  }

  private readNotesReport(
    outputPath: string,
    requestedSlides?: readonly SlideIndex[],
  ): NotesReportResult {
    if (!fs.existsSync(outputPath)) {
      return { success: false, message: "PowerPoint did not report slide notes." };
    }
    return parseNotesReport(
      fs.readFileSync(outputPath, "utf8"),
      requestedSlides?.map(slideNumberOf),
    );
  }

  async readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult> {
    const officeContainer = this.getOfficeContainerPath();
    const outputPath = path.join(officeContainer, "export_all_notes.txt");

    try {
      cleanupPaths(outputPath);
      const scriptResult = await this.triggerMacro(
        "ExportAllSlideNotes",
        filePath,
        "export_all_notes_params.txt",
        `${filePath}|${outputPath}`,
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Failed to export slide notes." };
      }

      return this.readNotesReport(outputPath);
    } catch (e: unknown) {
      return { success: false, message: getErrorMessage(e) };
    } finally {
      cleanupPaths(outputPath);
    }
  }

  async readSlideNotes(filePath: string, slideIndex: SlideIndex): Promise<ReadSlideNotesResult> {
    const officeContainer = this.getOfficeContainerPath();
    const outputPath = path.join(officeContainer, "export_slide_notes.txt");

    try {
      cleanupPaths(outputPath);
      const scriptResult = await this.triggerMacro(
        "ExportSlideNotes",
        filePath,
        "export_slide_notes_params.txt",
        `${filePath}|${slideNumberOf(slideIndex)}|${outputPath}`,
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Failed to export slide notes." };
      }

      const notesResult = this.readNotesReport(outputPath, [slideIndex]);
      if (!notesResult.success) {
        return notesResult;
      }
      return { success: true, notes: notesResult.notes.get(slideIndex) ?? "" };
    } catch (e: unknown) {
      return { success: false, message: getErrorMessage(e) };
    } finally {
      cleanupPaths(outputPath);
    }
  }

  private async readSectionAudioPlayback(
    filePath: string,
    slideIndices: readonly SlideIndex[],
  ): Promise<SectionAudioPlaybackResult> {
    const officeContainer = this.getOfficeContainerPath();
    const outputPath = path.join(officeContainer, "export_audio_playback.txt");
    const slideNumbers = slideIndices.map(slideNumberOf);
    let previousApp: string | undefined;

    try {
      cleanupPaths(outputPath);
      const scriptResult = await this.triggerMacro(
        "ExportSectionAudioPlayback",
        filePath,
        "export_audio_playback_params.txt",
        `${filePath}|${slideNumbers.join(",")}|${outputPath}`,
        "target-window",
      );
      previousApp = scriptResult.data?.previousApp;
      if (!scriptResult.success) {
        return {
          success: false,
          message: scriptResult.message || "Failed to read section audio playback.",
        };
      }

      if (!fs.existsSync(outputPath)) {
        return { success: false, message: "PowerPoint did not report section audio playback." };
      }
      return parseSectionAudioPlaybackReport(fs.readFileSync(outputPath, "utf8"), slideNumbers);
    } catch (e: unknown) {
      return { success: false, message: getErrorMessage(e) };
    } finally {
      cleanupPaths(outputPath);
      await this.restoreForeground(previousApp);
    }
  }

  /** Required slide data is read before image export, so a failed reload never clears the images in use. */
  async convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult> {
    try {
      const notesResult = await this.readAllSlideNotes(filePath);
      if (!notesResult.success) {
        return notesResult;
      }

      const playbackResult = await this.readSectionAudioPlayback(filePath, [
        ...notesResult.notes.keys(),
      ]);
      if (!playbackResult.success) {
        return playbackResult;
      }

      const images = exportedPreviewImages(await this.exportSlideImages(filePath, outputDir));
      const slides = this.mergeSlideData(images, notesResult.notes, playbackResult.playback);
      return { success: true, slides: buildSlidesWithPaths(slides, outputDir) };
    } catch (err: unknown) {
      return { success: false, message: getErrorMessage(err) };
    } finally {
      // Image export brings PowerPoint to the front.
      this.focusApp();
    }
  }

  saveSlideNarration(
    filePath: string,
    slide: SlideNarrationEntry,
  ): Promise<SlideNarrationSaveResult> {
    return this.saveNarration(filePath, {
      action: "saving the slide",
      slideIndices: [slide.slideIndex],
      notes: [{ slideIndex: slide.slideIndex, notes: slide.notes }],
      audio: slide.audio,
    });
  }

  async removeAudio(filePath: string, slideIndices: SlideIndex[]): Promise<BasicPptResult> {
    const result = await this.saveNarration(filePath, {
      action: "removing audio",
      slideIndices,
      audio: [],
    });
    if (result.success) {
      return result;
    }
    const saved =
      result.saved === "notesAndAudio"
        ? "PowerPoint removed the section audio and saved the presentation. "
        : "";
    return { success: false, message: `${saved}${result.message}` };
  }

  /**
   * The macro saves the presentation as it was before changing it, then saves the
   * new notes and section audio together. A failure in between leaves edits in
   * PowerPoint's memory that any later save would write, so only then, or when the
   * macro stopped responding without saying how far it got, is the deck reloaded as
   * last saved; earlier failures leave it open as it was.
   */
  private async saveNarration(
    filePath: string,
    request: NarrationSaveRequest,
  ): Promise<SlideNarrationSaveResult> {
    const officeContainer = this.getOfficeContainerPath();
    const sessionId = Date.now();
    const sessionDir = path.join(officeContainer, "TemporaryAudio", `session-${sessionId}`);
    const resultPath = path.join(officeContainer, "save_narration_result.txt");
    const notesFile = request.notes && {
      path: path.join(officeContainer, `notes_data_${sessionId}.txt`),
      data: formatNotesData(request.notes),
    };
    const slideNumbers = request.slideIndices.map(slideNumberOf);

    let result: BasicPptResult;
    let report: string | undefined;
    let macroReturned = true;
    let previousApp: string | undefined;
    try {
      let params: string;
      try {
        params = formatSaveNarrationParams(
          filePath,
          resultPath,
          notesFile?.path,
          slideNumbers,
          this.stageAudio(sessionDir, request.audio),
        );
        if (notesFile) {
          fs.writeFileSync(notesFile.path, notesFile.data, "utf8");
        }
        cleanupPaths(resultPath);
      } catch (e: unknown) {
        return {
          success: false,
          saved: "nothing",
          message: `Could not prepare the files PowerPoint needs: ${getErrorMessage(e)}`,
        };
      }

      const scriptResult = await this.triggerMacro(
        "SaveNarration",
        filePath,
        "save_narration_params.txt",
        params,
        request.audio.length > 0 ? "target-window" : "background",
      );
      previousApp = scriptResult.data?.previousApp;
      macroReturned = scriptResult.success;
      report = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : undefined;
      result = scriptResult.success
        ? checkSaveNarrationReport(report, request.action, slideNumbers, request.audio)
        : {
            success: false,
            message: scriptResult.message || "Failed to run the PowerPoint macro.",
          };
    } catch (e: unknown) {
      result = { success: false, message: getErrorMessage(e) };
    } finally {
      cleanupPaths(resultPath, sessionDir, notesFile?.path);
    }

    const outcome = result.success
      ? result
      : await this.settleFailedSave(
          filePath,
          result.message,
          narrationSavePhase(report, macroReturned),
        );
    await this.restoreForeground(previousApp);
    return outcome;
  }

  private async settleFailedSave(
    filePath: string,
    failure: string,
    phase: NarrationSavePhase,
  ): Promise<SlideNarrationSaveResult> {
    switch (phase) {
      case "editing":
        return {
          success: false,
          saved: "nothing",
          message: await this.discardFailedChanges(filePath, failure),
        };
      case "unknown":
        return {
          success: false,
          saved: "unknown",
          message: await this.discardFailedChanges(
            filePath,
            `${failure} PowerPoint did not report whether it saved the presentation.`,
            "It was closed without saving and reopened as last saved; check it in PowerPoint, as edits it had not saved may be lost.",
          ),
        };
      case "saved":
        return { success: false, saved: "notesAndAudio", message: failure };
      case "unchanged":
        return { success: false, saved: "nothing", message: failure };
    }
  }

  private stageAudio(sessionDir: string, audio: readonly SlideAudioEntry[]): StagedSlideAudio[] {
    return audio.map((entry) => {
      const slideDir = path.join(sessionDir, `slide_${slideNumberOf(entry.slideIndex)}`);
      fs.mkdirSync(slideDir, { recursive: true });
      const audioPath = path.join(slideDir, buildPptAudioFileName(entry.sectionIndex));
      fs.writeFileSync(audioPath, Buffer.from(entry.audioData));
      return { entry, audioPath };
    });
  }

  private async discardFailedChanges(
    filePath: string,
    failure: string,
    discarded?: string,
  ): Promise<string> {
    const closed = await this.close(filePath, "discard");
    if (!closed.closed) {
      return `${failure} PowerPoint could not discard the failed changes (${closed.message}); close the presentation without saving before continuing.`;
    }
    const reopenFailure = await this.reopen(filePath, closed.slideIndex);
    if (reopenFailure !== undefined) {
      return `${failure} The failed changes were discarded, but PowerPoint could not reopen the presentation (${reopenFailure}).`;
    }
    return discarded ? `${failure} ${discarded}` : failure;
  }

  async generateVideo(filePath: string, videoOutputPath: string): Promise<VideoPptResult> {
    try {
      const exportScriptPath = resolveScriptPath("export-to-video.applescript");
      const child = spawn("osascript", [exportScriptPath, videoOutputPath, filePath]);

      await new Promise<void>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", (code: number) => {
          if (code === 0 && !stdout.includes("Error")) {
            this.focusApp();
            resolve();
          } else {
            reject(new Error(stdout || stderr));
          }
        });
      });
      return { success: true, outputPath: videoOutputPath };
    } catch (e: unknown) {
      return { success: false, message: getErrorMessage(e) };
    }
  }

  async playSlide(filePath: string, slideIndex: SlideIndex): Promise<BasicPptResult> {
    const scriptResult = await this.runAppleScriptJson("play-slide.applescript", [
      slideNumberOf(slideIndex).toString(),
      filePath,
    ]);
    if (!scriptResult.success) {
      return { success: false, message: scriptResult.message || "Failed to play slide." };
    }

    return { success: true };
  }

  private async readSlideContent(
    filePath: string,
    slideIndex: SlideIndex,
  ): Promise<ReadSlideContentResult> {
    const notesResult = await this.readSlideNotes(filePath, slideIndex);
    if (!notesResult.success) {
      return notesResult;
    }

    const playbackResult = await this.readSectionAudioPlayback(filePath, [slideIndex]);
    if (!playbackResult.success) {
      return playbackResult;
    }

    return {
      success: true,
      notes: notesResult.notes,
      sectionsPlayingAcrossSlides: sectionsPlayingAcrossSlidesOn(
        playbackResult.playback,
        slideIndex,
      ),
    };
  }

  async reloadSlide(
    filePath: string,
    slideIndex: SlideIndex,
    outputDir: string,
  ): Promise<SlidePptResult> {
    try {
      const contentResult = await this.readSlideContent(filePath, slideIndex);
      if (!contentResult.success) {
        return contentResult;
      }

      const image = reloadedPreviewImage(
        slideIndex,
        await this.reloadSlideImage(filePath, slideIndex, outputDir),
      );
      return completeSlideReload(outputDir, slideIndex, contentResult, image);
    } finally {
      try {
        this.focusApp();
      } catch (error) {
        console.error("Failed to focus app after reloading slide:", error);
      }
    }
  }
}

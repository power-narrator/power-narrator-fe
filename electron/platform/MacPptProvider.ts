import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import type { NativePlatformProvider, PptProvider } from "./PptProvider.js";
import {
  FIRST_SLIDE_INDEX,
  slideIndexFromOneBased,
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
  resolveScriptPath,
} from "./helpers.js";
import {
  parseSectionAudioPlaybackReport,
  sectionsPlayingAcrossSlidesOn,
  type SectionAudioPlaybackResult,
} from "./sectionAudioPlayback.js";
import { completeSlideReload } from "./slideReload.js";
import {
  checkInsertAudioReport,
  checkRemoveAudioReport,
  formatInsertAudioParams,
} from "./macInsertAudio.js";
import type {
  BasicPptResult,
  SectionsPlayingAcrossSlides,
  ExportSlideImagesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  ReloadSlideImageResult,
  SlideAudioEntry,
  SlideImageMap,
  SlideManifestEntry,
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
    };

type ClosedPresentation =
  | { closed: true; slideIndex: SlideIndex }
  | { closed: false; slideIndex: SlideIndex; message: string };

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
    return [...images.keys()]
      .toSorted((a, b) => a - b)
      .map((slideIndex) => ({
        slideIndex,
        image: images.get(slideIndex)?.image || "",
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

  private parseNotesExportFile(filePath: string): SlideNotesMap {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r\n|\n|\r/);
    const notes = new Map<SlideIndex, string>();
    let currentSlideNumber: number | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("###SLIDE_START### ")) {
        currentSlideNumber = Number(line.slice("###SLIDE_START### ".length));
        currentLines = [];
        continue;
      }

      if (line === "###SLIDE_END###") {
        if (currentSlideNumber !== null && Number.isInteger(currentSlideNumber)) {
          notes.set(slideIndexFromOneBased(currentSlideNumber), currentLines.join("\n"));
        }
        currentSlideNumber = null;
        currentLines = [];
        continue;
      }

      if (currentSlideNumber !== null) {
        currentLines.push(line);
      }
    }

    return notes;
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
  ): Promise<AppleScriptResult> {
    const paramsPath = path.join(this.getOfficeContainerPath(), paramsFileName);
    try {
      fs.writeFileSync(paramsPath, params, "utf8");
      return await this.runAppleScriptJson("trigger-macro.applescript", [macroName, filePath]);
    } finally {
      cleanupPaths(paramsPath);
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
  }

  /** Resolves to the failure, if any. */
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

    this.focusApp();
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

      const notes = this.parseNotesExportFile(outputPath);
      return { success: true, notes };
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

      const notes = this.parseNotesExportFile(outputPath);
      return { success: true, notes: notes.get(slideIndex) || "" };
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

    try {
      cleanupPaths(outputPath);
      const scriptResult = await this.triggerMacro(
        "ExportSectionAudioPlayback",
        filePath,
        "export_audio_playback_params.txt",
        `${filePath}|${slideNumbers.join(",")}|${outputPath}`,
      );
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
      this.focusApp();
    }
  }

  async convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult> {
    const imageResult = await this.exportSlideImages(filePath, outputDir);
    if (!imageResult.success) {
      return imageResult;
    }

    const notesResult = await this.readAllSlideNotes(filePath);
    if (!notesResult.success) {
      return notesResult;
    }

    const playbackResult = await this.readSectionAudioPlayback(filePath, [
      ...imageResult.images.keys(),
    ]);
    if (!playbackResult.success) {
      return playbackResult;
    }

    try {
      const slides = this.mergeSlideData(
        imageResult.images,
        notesResult.notes,
        playbackResult.playback,
      );

      this.focusApp();
      return { success: true, slides: buildSlidesWithPaths(slides, outputDir) };
    } catch (err: unknown) {
      return { success: false, message: getErrorMessage(err) };
    }
  }

  async insertAudio(filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
    if (!slidesAudio || slidesAudio.length === 0) return { success: true };

    return this.discardChangesOnFailure(filePath, () => this.runInsertAudio(filePath, slidesAudio));
  }

  private async runInsertAudio(
    filePath: string,
    slidesAudio: SlideAudioEntry[],
  ): Promise<BasicPptResult> {
    const officeContainer = this.getOfficeContainerPath();
    const audioSessionDir = path.join(officeContainer, "TemporaryAudio", `session-${Date.now()}`);

    try {
      fs.mkdirSync(audioSessionDir, { recursive: true });
    } catch {
      return { success: false, message: "Could not create audio directory in Office container." };
    }

    const resultPath = path.join(officeContainer, "insert_audio_result.txt");

    try {
      const stagedAudio = slidesAudio.map((entry) => {
        const slideDir = path.join(audioSessionDir, `slide_${slideNumberOf(entry.slideIndex)}`);
        fs.mkdirSync(slideDir, { recursive: true });
        const audioPath = path.join(slideDir, buildPptAudioFileName(entry.sectionIndex));
        fs.writeFileSync(audioPath, Buffer.from(entry.audioData));
        return { entry, audioPath };
      });

      cleanupPaths(resultPath);
      const scriptResult = await this.triggerMacro(
        "InsertAudio",
        filePath,
        "insert_audio_params.txt",
        formatInsertAudioParams(filePath, resultPath, stagedAudio),
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Failed to insert audio." };
      }

      const report = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : undefined;
      const result = checkInsertAudioReport(report, slidesAudio);
      if (result.success) {
        this.focusApp();
      }
      return result;
    } catch (e: unknown) {
      return { success: false, message: getErrorMessage(e) };
    } finally {
      cleanupPaths(resultPath, audioSessionDir);
    }
  }

  removeAudio(filePath: string, slideIndices: SlideIndex[]): Promise<BasicPptResult> {
    return this.discardChangesOnFailure(filePath, () =>
      this.runRemoveAudio(filePath, slideIndices),
    );
  }

  private async runRemoveAudio(
    filePath: string,
    slideIndices: SlideIndex[],
  ): Promise<BasicPptResult> {
    const officeContainer = this.getOfficeContainerPath();
    const resultPath = path.join(officeContainer, "remove_audio_result.txt");

    try {
      const slideNumbers = slideIndices.map(slideNumberOf);
      cleanupPaths(resultPath);
      const scriptResult = await this.triggerMacro(
        "RemoveAudio",
        filePath,
        "remove_audio_params.txt",
        `${filePath}|${slideNumbers.join(",")}|${resultPath}`,
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Failed to remove audio." };
      }

      const report = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : undefined;
      const result = checkRemoveAudioReport(report, slideNumbers);
      if (result.success) {
        this.focusApp();
      }
      return result;
    } catch (e: unknown) {
      return { success: false, message: getErrorMessage(e) };
    } finally {
      cleanupPaths(resultPath);
    }
  }

  /**
   * A failed audio macro can leave edits in PowerPoint's memory, such as
   * animations PowerPoint degraded while rebuilding a slide. Any later save would
   * write them, so reload the deck as last saved. Callers save notes just before.
   */
  private async discardChangesOnFailure(
    filePath: string,
    edit: () => Promise<BasicPptResult>,
  ): Promise<BasicPptResult> {
    const result = await edit();
    if (result.success) {
      return result;
    }

    const closed = await this.close(filePath, "discard");
    if (!closed.closed) {
      return {
        success: false,
        message: `${result.message} PowerPoint could not discard the failed changes (${closed.message}); close the presentation without saving before continuing.`,
      };
    }
    const reopenFailure = await this.reopen(filePath, closed.slideIndex);
    if (reopenFailure !== undefined) {
      return {
        success: false,
        message: `${result.message} The failed changes were discarded, but PowerPoint could not reopen the presentation (${reopenFailure}).`,
      };
    }
    return result;
  }

  async saveNotes(filePath: string, slides: SlideNotesEntry[]): Promise<BasicPptResult> {
    const officeContainer = this.getOfficeContainerPath();

    let dataContent = "";
    for (const s of slides) {
      dataContent += `###SLIDE_START### ${slideNumberOf(s.slideIndex)}\n${s.notes || ""}\n###SLIDE_END###\n`;
    }

    const dataPath = path.join(officeContainer, `notes_data_${Date.now()}.txt`);
    fs.writeFileSync(dataPath, dataContent, "utf8");

    try {
      const scriptResult = await this.triggerMacro(
        "UpdateNotes",
        filePath,
        "update_notes_params.txt",
        `${filePath}|${dataPath}`,
      );
      if (!scriptResult.success) {
        return { success: false, message: scriptResult.message || "Failed to update notes." };
      }

      this.focusApp();
      return { success: true };
    } finally {
      cleanupPaths(dataPath);
    }
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

  async reloadSlide(
    filePath: string,
    slideIndex: SlideIndex,
    outputDir: string,
  ): Promise<SlidePptResult> {
    const imageResult = await this.reloadSlideImage(filePath, slideIndex, outputDir);
    if (!imageResult.success) {
      return imageResult;
    }

    const result = await completeSlideReload(outputDir, slideIndex, imageResult.image, async () => {
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
    });

    if (result.success) {
      try {
        this.focusApp();
      } catch (error) {
        console.error("Failed to focus app after reloading slide:", error);
      }
    }

    return result;
  }
}

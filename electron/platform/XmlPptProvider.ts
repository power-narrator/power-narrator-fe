import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import type { NativePlatformProvider, PptProvider } from "./PptProvider.js";
import {
  FIRST_SLIDE_INDEX,
  slideNumberOf,
  toSlideIndex,
  type SlideIndex,
} from "../../shared/slides/slideCoordinates.js";
import { getErrorMessage } from "./errors.js";
import {
  buildSlidesWithPaths,
  buildPptAudioFileName,
  cleanupPaths,
  exportedPreviewImages,
  normalizeNotes,
  reloadedPreviewImage,
  resolveScriptPath,
  sectionIndexFromPptAudioShapeName,
} from "./helpers.js";
import { completeSlideReload } from "./slideReload.js";
import type {
  BasicPptResult,
  SectionsPlayingAcrossSlides,
  QuerySlidesResult,
  ReadAllSlideNotesResult,
  ReadSlideNotesResult,
  RunXmlCliResult,
  SlideAudioEntry,
  SlidePptResult,
  SlideNarrationEntry,
  SlideNarrationSaveResult,
  SlideNotesEntry,
  SlidesPptResult,
  XmlCliOperation,
  XmlCliOperationResult,
  XmlCliResponse,
  XmlSlideAudio,
  XmlSlideData,
} from "./types.js";

/** This integration does not read section audio playback yet, so every section loads unchecked. */
const NO_SECTIONS_PLAYING_ACROSS_SLIDES: SectionsPlayingAcrossSlides = new Set();

export class XmlPptProvider implements PptProvider {
  constructor(private nativeProvider?: NativePlatformProvider) {}

  private async querySlides(
    filePath: string,
    options: { skipClose?: boolean; skipReopen?: boolean } = {},
  ): Promise<QuerySlidesResult> {
    const queryResult = await this.runXmlCli(
      filePath,
      null,
      [{ op: "get_slides", args: {} }],
      options,
    );
    if (!queryResult.success) {
      return { success: false, message: "Failed to query slide content: " + queryResult.message };
    }

    const firstResult = queryResult.data.results[0];
    if (firstResult && firstResult.success !== true) {
      const reason =
        firstResult.success === false && firstResult.message
          ? firstResult.message
          : "the slide report did not confirm success";
      return { success: false, message: `Failed to query slide content: ${reason}` };
    }
    if (!firstResult || !Array.isArray(firstResult.result)) {
      return { success: false, message: "Could not find slide data" };
    }

    const slideData: unknown[] = firstResult.result;
    const unreadable = slideData.findIndex(
      (slide) =>
        typeof slide !== "object" ||
        slide === null ||
        typeof (slide as Partial<XmlSlideData>).notes !== "string",
    );
    if (unreadable !== -1) {
      return {
        success: false,
        message: `Could not read the notes of slide ${slideNumberOf(toSlideIndex(unreadable))}.`,
      };
    }

    return { success: true, slideData: slideData as XmlSlideData[] };
  }

  /** The CLI's `slide_index` argument is already 0-based, so indices pass straight through. */
  private buildDeleteAudioOpsForSlides(
    slideData: XmlSlideData[],
    targetSlideIndices: Iterable<SlideIndex>,
  ): XmlCliOperation[] {
    const deleteOps: XmlCliOperation[] = [];

    for (const slideIndex of targetSlideIndices) {
      const slide = slideData[slideIndex];
      if (!slide) continue;

      const slideAudio = slide.audio || [];
      slideAudio
        .filter(
          (audio: XmlSlideAudio) => sectionIndexFromPptAudioShapeName(audio.name) !== undefined,
        )
        .forEach((audio) => {
          deleteOps.push({
            op: "delete_audio_for_slide",
            args: { slide_index: slideIndex, name: audio.name },
          });
        });
    }

    return deleteOps;
  }

  private async runXmlCli(
    inputPath: string,
    outputPath: string | null,
    ops: XmlCliOperation[],
    options: { skipClose?: boolean; skipReopen?: boolean } = {},
  ): Promise<RunXmlCliResult> {
    const tempDir = app.getPath("temp");
    const reqPath = path.join(tempDir, "request.json");
    const resPath = path.join(tempDir, "response.json");

    const payload = { input: inputPath, output: outputPath, ops };
    fs.writeFileSync(reqPath, JSON.stringify(payload, null, 2), "utf8");

    let currentSlideIndex = FIRST_SLIDE_INDEX;
    if (!options.skipClose && this.nativeProvider) {
      currentSlideIndex = await this.nativeProvider.closePresentation(inputPath);
    }

    const cliResult: RunXmlCliResult = await new Promise((resolve) => {
      const env = Object.assign({}, process.env);
      const localBinDir = path.join(app.getPath("home"), ".local", "bin");
      if (env.PATH && !env.PATH.includes(localBinDir)) {
        env.PATH = `${localBinDir}:${env.PATH}`;
      }

      const cliPath = resolveScriptPath("power-narrator-cli");
      const child = spawn(cliPath, [reqPath, resPath], { env: env });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      child.on("close", (code: number) => {
        let success = false;
        let error = "";
        let data: XmlCliResponse | undefined;

        if (fs.existsSync(resPath)) {
          try {
            const resultData = JSON.parse(fs.readFileSync(resPath, "utf8")) as XmlCliResponse;
            data = resultData;

            if (code === 0) {
              success = true;
            } else {
              const resultMessages = Array.isArray(resultData?.results)
                ? resultData.results
                    .filter((result: XmlCliOperationResult) => !result.success && result.message)
                    .map((result: XmlCliOperationResult) => result.message)
                : [];
              const details =
                resultMessages.length > 0 ? `Details: ${resultMessages.join("; ")}` : "";
              const stderrDetails = stderr ? `Stderr: ${stderr}` : "";
              const stdoutDetails = stdout ? `Stdout: ${stdout}` : "";
              error = [`CLI failed with code ${code}.`, details, stderrDetails, stdoutDetails]
                .filter(Boolean)
                .join("\n");
            }
          } catch (e: unknown) {
            error = `Failed to parse response JSON: ${getErrorMessage(e)}. Stderr: ${stderr}`;
          }
        } else {
          error = `CLI did not produce response.json. Code: ${code}. Stderr: ${stderr}. Stdout: ${stdout}`;
        }

        cleanupPaths(reqPath, resPath);
        resolve(
          success && data
            ? { success: true, data }
            : { success: false, message: error || "CLI failed" },
        );
      });

      child.on("error", (err: Error) => {
        cleanupPaths(reqPath, resPath);
        resolve({ success: false, message: `Failed to start process: ${getErrorMessage(err)}` });
      });
    });

    if (!options.skipReopen && this.nativeProvider) {
      await this.nativeProvider.reopenPresentation(inputPath, currentSlideIndex);
    }

    return cliResult;
  }

  async saveSlideNarration(
    filePath: string,
    slide: SlideNarrationEntry,
  ): Promise<SlideNarrationSaveResult> {
    const notesResult = await this.saveNotes(filePath, [
      { slideIndex: slide.slideIndex, notes: slide.notes },
    ]);
    if (!notesResult.success) {
      return { ...notesResult, saved: "nothing" };
    }

    const audioResult =
      slide.audio.length > 0
        ? await this.insertAudio(filePath, slide.audio)
        : await this.removeAudio(filePath, [slide.slideIndex]);
    return audioResult.success ? { success: true } : { ...audioResult, saved: "notes" };
  }

  async insertAudio(filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
    if (!slidesAudio || slidesAudio.length === 0) return { success: true };

    const tempDir = app.getPath("temp");
    const sessionDir = path.join(tempDir, `ppt_audio_${Date.now()}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    let slideIndexBefore = FIRST_SLIDE_INDEX;
    if (this.nativeProvider) {
      slideIndexBefore = await this.nativeProvider.closePresentation(filePath);
    }

    try {
      const slidesToClear = new Set<SlideIndex>();
      for (const slide of slidesAudio) slidesToClear.add(slide.slideIndex);

      const queryResult = await this.querySlides(filePath, {
        skipClose: true,
        skipReopen: true,
      });
      if (!queryResult.success) {
        return queryResult;
      }

      const slideData = queryResult.slideData;
      if (!slideData) {
        return { success: false, message: "Could not find slide data" };
      }

      const ops: XmlCliOperation[] = this.buildDeleteAudioOpsForSlides(slideData, slidesToClear);

      const slideAudioEntriesBySlide = new Map<SlideIndex, SlideAudioEntry[]>();
      for (const slide of slidesAudio) {
        const slideEntries = slideAudioEntriesBySlide.get(slide.slideIndex) ?? [];
        slideEntries.push(slide);
        slideAudioEntriesBySlide.set(slide.slideIndex, slideEntries);
      }

      for (const slide of slidesAudio) {
        const buffer = Buffer.from(slide.audioData);
        const slideDir = path.join(sessionDir, `slide_${slide.slideIndex}`);
        fs.mkdirSync(slideDir, { recursive: true });
        const audioFileName = buildPptAudioFileName(slide.sectionIndex);
        const audioFilePath = path.join(slideDir, audioFileName);
        fs.writeFileSync(audioFilePath, buffer);
      }

      for (const [slideIndex, slideEntries] of slideAudioEntriesBySlide) {
        for (const slide of slideEntries.toReversed()) {
          const slideDir = path.join(sessionDir, `slide_${slideIndex}`);
          const audioFileName = buildPptAudioFileName(slide.sectionIndex);
          const audioFilePath = path.join(slideDir, audioFileName);

          ops.push({
            op: "save_audio_for_slide",
            args: { slide_index: slideIndex, mp3_path: audioFilePath },
          });
        }
      }

      return await this.runXmlCli(filePath, filePath, ops, {
        skipClose: true,
        skipReopen: true,
      });
    } finally {
      cleanupPaths(sessionDir);
      if (this.nativeProvider) {
        await this.nativeProvider.reopenPresentation(filePath, slideIndexBefore);
      }
    }
  }

  async removeAudio(filePath: string, slideIndices: SlideIndex[]): Promise<BasicPptResult> {
    let slideIndexBefore = FIRST_SLIDE_INDEX;
    if (this.nativeProvider) {
      slideIndexBefore = await this.nativeProvider.closePresentation(filePath);
    }

    try {
      const queryResult = await this.querySlides(filePath, {
        skipClose: true,
        skipReopen: true,
      });

      if (!queryResult.success) {
        return queryResult;
      }

      const missingIndex = slideIndices.find((slideIndex) => !queryResult.slideData[slideIndex]);
      if (missingIndex !== undefined) {
        return {
          success: false,
          message: "Could not find slide data for slide " + slideNumberOf(missingIndex),
        };
      }

      const deleteOps = this.buildDeleteAudioOpsForSlides(queryResult.slideData, slideIndices);
      if (deleteOps.length === 0) {
        return { success: true };
      }

      return await this.runXmlCli(filePath, filePath, deleteOps, {
        skipClose: true,
        skipReopen: true,
      });
    } finally {
      if (this.nativeProvider) {
        await this.nativeProvider.reopenPresentation(filePath, slideIndexBefore);
      }
    }
  }

  async readAllSlideNotes(filePath: string): Promise<ReadAllSlideNotesResult> {
    const queryResult = await this.querySlides(filePath);
    if (!queryResult.success) {
      return queryResult;
    }

    // `get_slides` answers with the whole deck in presentation order, so a
    // slide's position in that answer is its presentation-wide slide index.
    return {
      success: true,
      notes: new Map(
        queryResult.slideData.map((slide, position) => [
          toSlideIndex(position),
          normalizeNotes(slide.notes),
        ]),
      ),
    };
  }

  async readSlideNotes(filePath: string, slideIndex: SlideIndex): Promise<ReadSlideNotesResult> {
    const queryResult = await this.querySlides(filePath);
    if (!queryResult.success) {
      return queryResult;
    }

    const slide = queryResult.slideData[slideIndex];
    if (!slide) {
      return {
        success: false,
        message: `Could not find slide data for slide ${slideNumberOf(slideIndex)}`,
      };
    }

    return { success: true, notes: normalizeNotes(slide.notes) };
  }

  async saveNotes(filePath: string, slides: SlideNotesEntry[]): Promise<BasicPptResult> {
    const ops = slides.map((s): XmlCliOperation => ({
      op: "set_slide_notes",
      args: { slide_index: s.slideIndex, notes: normalizeNotes(s.notes || "") },
    }));

    if (ops.length === 0) return { success: true };

    return await this.runXmlCli(filePath, filePath, ops);
  }

  async convertPptx(filePath: string, outputDir: string): Promise<SlidesPptResult> {
    if (!this.nativeProvider) {
      return { success: false, message: "Slide image export is not supported on this platform" };
    }

    const queryResult = await this.querySlides(filePath);
    if (!queryResult.success) {
      return queryResult;
    }

    const { nativeProvider } = this;
    const images = await exportedPreviewImages(() =>
      nativeProvider.exportSlideImages(filePath, outputDir),
    );

    const slides = queryResult.slideData.map((slide, position) => {
      const slideIndex = toSlideIndex(position);

      return {
        slideIndex,
        image: images.get(slideIndex)?.image || null,
        notes: slide.notes,
        sectionsPlayingAcrossSlides: NO_SECTIONS_PLAYING_ACROSS_SLIDES,
      };
    });

    return { success: true, slides: buildSlidesWithPaths(slides, outputDir) };
  }

  async reloadSlide(
    filePath: string,
    slideIndex: SlideIndex,
    outputDir: string,
  ): Promise<SlidePptResult> {
    if (!this.nativeProvider) {
      return { success: false, message: "Slide image export is not supported on this platform" };
    }

    const queryResult = await this.querySlides(filePath);
    if (!queryResult.success) {
      return queryResult;
    }

    const slide = queryResult.slideData[slideIndex];
    if (!slide) {
      return {
        success: false,
        message: `Could not find slide data for slide ${slideNumberOf(slideIndex)}`,
      };
    }

    const { nativeProvider } = this;
    const image = await reloadedPreviewImage(slideIndex, () =>
      nativeProvider.reloadSlideImage(filePath, slideIndex, outputDir),
    );
    return completeSlideReload(
      outputDir,
      slideIndex,
      { notes: slide.notes, sectionsPlayingAcrossSlides: NO_SECTIONS_PLAYING_ACROSS_SLIDES },
      image,
    );
  }
}

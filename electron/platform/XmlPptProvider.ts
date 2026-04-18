import { app } from "electron";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { PptProvider } from "./PptProvider.js";
import { resolveScriptPath } from "./helpers.js";

export class XmlPptProvider implements PptProvider {
  /**
   * Initializes a new instance of the XmlPptProvider class.
   *
   * @param baseProvider - The underlying PptProvider to use for delegated operations.
   */
  constructor(private baseProvider: PptProvider) {}

  /**
   * Helper to safely remove temporary files or directories.
   *
   * @param paths - One or more paths to remove.
   */
  private cleanupFiles(...paths: (string | null)[]): void {
    for (const p of paths) {
      if (!p) continue;
      try {
        if (fs.existsSync(p)) {
          const stats = fs.statSync(p);
          if (stats.isDirectory()) {
            fs.rmSync(p, { recursive: true, force: true });
          } else {
            fs.unlinkSync(p);
          }
        }
      } catch (e) {
        console.error(`Cleanup failed for ${p}:`, e);
      }
    }
  }

  private buildDeleteAudioOpsForSlides(slideData: any[], targetSlideIndexes: number[]): any[] {
    const deleteOps: any[] = [];

    for (const targetIndex of targetSlideIndexes) {
      const slide = slideData[targetIndex];
      if (!slide) continue;

      const slideAudio = slide.audio || [];
      slideAudio
        .filter((audio: any) => audio.name.toLowerCase().includes("ppt_audio"))
        .forEach((audio: any) => {
          deleteOps.push({
            op: "delete_audio_for_slide",
            args: { slide_index: targetIndex, name: audio.name },
          });
        });
    }

    return deleteOps;
  }

  /**
   * Executes the XML-based CLI (slide-voice-pptx) to perform PowerPoint operations.
   *
   * This method handles state management by closing the presentation via the base provider
   * before running the CLI and reopening it afterwards, ensuring consistency.
   *
   * @param inputPath - Path to the input .pptx file.
   * @param outputPath - Path where the modified .pptx file should be saved (can be same as input).
   * @param ops - An array of operation objects to be executed by the CLI.
   * @param options - Optional configuration for controlling presentation closing/reopening.
   * @returns A promise resolving to the CLI execution result.
   */
  private async runXmlCli(
    inputPath: string,
    outputPath: string | null,
    ops: any[],
    options: { skipClose?: boolean; skipReopen?: boolean } = {},
  ): Promise<any> {
    const tempDir = app.getPath("temp");
    const reqPath = path.join(tempDir, "request.json");
    const resPath = path.join(tempDir, "response.json");

    const payload = { input: inputPath, output: outputPath, ops: ops };
    fs.writeFileSync(reqPath, JSON.stringify(payload, null, 2), "utf8");

    let currentSlideIndex = 1;
    if (!options.skipClose && this.baseProvider.closePresentation) {
      currentSlideIndex = await this.baseProvider.closePresentation(inputPath);
    }

    const cliResult: any = await new Promise((resolve) => {
      const env = Object.assign({}, process.env);
      const localBinDir = path.join(app.getPath("home"), ".local", "bin");
      if (env.PATH && !env.PATH.includes(localBinDir)) {
        env.PATH = `${localBinDir}:${env.PATH}`;
      }

      let child;
      if (app.isPackaged) {
        const cliPath = resolveScriptPath(path.join("xml-cli", "slide-voice-pptx"));
        child = spawn(cliPath, [reqPath, resPath], { env: env });
      } else {
        const cliDir = path.join(__dirname, "../../xml/slide-voice-app");
        child = spawn("uv", ["run", "-m", "slide_voice_pptx", reqPath, resPath], {
          cwd: cliDir,
          env: env,
        });
      }

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: any) => (stdout += d.toString()));
      child.stderr.on("data", (d: any) => (stderr += d.toString()));

      child.on("close", (code: number) => {
        let success = false;
        let error = "";
        let data = null;

        if (fs.existsSync(resPath)) {
          try {
            const resultData = JSON.parse(fs.readFileSync(resPath, "utf8"));
            data = resultData;

            if (code === 0) {
              success = true;
            } else {
              const resultMessages = Array.isArray(resultData?.results)
                ? resultData.results
                    .filter((result: any) => !result?.success && result?.message)
                    .map((result: any) => result.message)
                : [];
              const details =
                resultMessages.length > 0 ? `Details: ${resultMessages.join("; ")}` : "";
              const stderrDetails = stderr ? `Stderr: ${stderr}` : "";
              const stdoutDetails = stdout ? `Stdout: ${stdout}` : "";
              error = [`CLI failed with code ${code}.`, details, stderrDetails, stdoutDetails]
                .filter(Boolean)
                .join("\n");
            }
          } catch (e: any) {
            error = `Failed to parse response JSON: ${e.message}. Stderr: ${stderr}`;
          }
        } else {
          error = `CLI did not produce response.json. Code: ${code}. Stderr: ${stderr}. Stdout: ${stdout}`;
        }

        this.cleanupFiles(reqPath, resPath);
        resolve({ success, data, error: error || undefined });
      });

      child.on("error", (err: any) => {
        this.cleanupFiles(reqPath, resPath);
        resolve({ success: false, error: `Failed to start process: ${err.message}` });
      });
    });

    if (!options.skipReopen && this.baseProvider.reopenPresentation) {
      await this.baseProvider.reopenPresentation(inputPath, currentSlideIndex);
    }

    return cliResult;
  }

  /**
   * Inserts audio into the specified PowerPoint slides.
   *
   * @param filePath - Path to the .pptx file.
   * @param slidesAudio - An array of objects containing slide indices and audio data.
   * @returns A promise resolving to the result of the insertion operation.
   */
  async insertAudio(filePath: string, slidesAudio: any[]): Promise<any> {
    if (!slidesAudio || slidesAudio.length === 0) return { success: true };

    const tempDir = app.getPath("temp");
    const sessionDir = path.join(tempDir, `ppt_audio_${Date.now()}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    let slideIndexBefore = 1;
    if (this.baseProvider.closePresentation) {
      slideIndexBefore = await this.baseProvider.closePresentation(filePath);
    }

    try {
      const slidesToClear = new Set<number>();
      for (const slide of slidesAudio) slidesToClear.add(slide.index);

      const queryResult = await this.runXmlCli(filePath, null, [{ op: "get_slides", args: {} }], {
        skipClose: true,
        skipReopen: true,
      });
      if (!queryResult.success) {
        return { success: false, error: "Failed to query slide content: " + queryResult.error };
      }

      const slideData = queryResult.data?.results?.[0]?.result;
      if (!slideData) {
        return { success: false, error: "Could not find slide data" };
      }

      const ops = this.buildDeleteAudioOpsForSlides(
        slideData,
        Array.from(slidesToClear, (slideIndex) => slideIndex - 1),
      );

      for (const slide of slidesAudio) {
        const buffer = Buffer.from(slide.audioData);
        const slideDir = path.join(sessionDir, `slide_${slide.index}`);
        fs.mkdirSync(slideDir, { recursive: true });
        const audioFileName =
          slide.sectionIndex !== undefined
            ? `ppt_audio_${slide.sectionIndex + 1}.mp3`
            : `ppt_audio_1.mp3`;
        const audioFilePath = path.join(slideDir, audioFileName);
        fs.writeFileSync(audioFilePath, buffer);

        ops.push({
          op: "save_audio_for_slide",
          args: { slide_index: slide.index - 1, mp3_path: audioFilePath },
        });
      }

      return await this.runXmlCli(filePath, filePath, ops, {
        skipClose: true,
        skipReopen: true,
      });
    } finally {
      this.cleanupFiles(sessionDir);
      if (this.baseProvider.reopenPresentation) {
        await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
      }
    }
  }

  /**
   * Removes audio from PowerPoint slides based on the specified scope.
   *
   * @param filePath - Path to the .pptx file.
   * @param scope - The scope of removal ("all" or "slide").
   * @param slideIndex - The 1-based index of the slide (relevant if scope is "slide").
   * @returns A promise resolving to the result of the removal operation.
   */
  async removeAudio(filePath: string, scope: string, slideIndex: number): Promise<any> {
    let slideIndexBefore = 1;
    if (this.baseProvider.closePresentation) {
      slideIndexBefore = await this.baseProvider.closePresentation(filePath);
    }

    const queryResult = await this.runXmlCli(filePath, null, [{ op: "get_slides", args: {} }], {
      skipClose: true,
      skipReopen: true,
    });

    if (!queryResult.success) {
      if (this.baseProvider.reopenPresentation)
        await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
      return { success: false, error: "Failed to query slide content: " + queryResult.error };
    }

    const slideData = queryResult.data?.results?.[0]?.result;
    if (!slideData) {
      if (this.baseProvider.reopenPresentation)
        await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
      return { success: false, error: "Could not find slide data" };
    }

    const targetIndex = slideIndex - 1;

    if (scope !== "all" && !slideData[targetIndex]) {
      if (this.baseProvider.reopenPresentation)
        await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
      return { success: false, error: "Could not find slide data for index " + targetIndex };
    }

    const deleteOps = this.buildDeleteAudioOpsForSlides(
      slideData,
      scope === "all" ? slideData.map((_: any, idx: number) => idx) : [targetIndex],
    );

    if (deleteOps.length === 0) {
      if (this.baseProvider.reopenPresentation)
        await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);
      return { success: true };
    }

    const result = await this.runXmlCli(filePath, filePath, deleteOps, {
      skipClose: true,
      skipReopen: true,
    });
    if (this.baseProvider.reopenPresentation)
      await this.baseProvider.reopenPresentation(filePath, slideIndexBefore);

    return result;
  }

  /**
   * Saves notes for multiple slides in the PowerPoint presentation.
   *
   * @param filePath - Path to the .pptx file.
   * @param slides - An array of slide objects containing notes to be saved.
   * @returns A promise resolving to the result of the save operation.
   */
  async saveAllNotes(filePath: string, slides: any[]): Promise<any> {
    const ops = slides
      .filter((s: any) => s.notes)
      .map((s: any) => ({
        op: "set_slide_notes",
        args: { slide_index: s.index - 1, notes: s.notes },
      }));

    if (ops.length === 0) return { success: true };

    return await this.runXmlCli(filePath, filePath, ops);
  }

  /**
   * Converts a PPTX file to a set of images or other formats.
   * Delegated to the base provider.
   *
   * @param filePath - Path to the .pptx file.
   * @param outputDir - Directory where converted files should be stored.
   */
  async convertPptx(filePath: string, outputDir: string): Promise<any> {
    return this.baseProvider.convertPptx(filePath, outputDir);
  }

  /**
   * Generates a video from the PowerPoint presentation.
   * Delegated to the base provider.
   *
   * @param filePath - Path to the .pptx file.
   * @param videoOutputPath - Path where the generated video should be saved.
   */
  async generateVideo(filePath: string, videoOutputPath: string): Promise<any> {
    return this.baseProvider.generateVideo(filePath, videoOutputPath);
  }

  /**
   * Shows a specific slide in PowerPoint.
   * Delegated to the base provider.
   *
   * @param slideIndex - The 1-based index of the slide to play.
   */
  async playSlide(filePath: string, slideIndex: number): Promise<any> {
    return this.baseProvider.playSlide(filePath, slideIndex);
  }

  /**
   * Reloads/Refreshes a specific slide.
   * Delegated to the base provider.
   *
   * @param filePath - Path to the .pptx file.
   * @param slideIndex - The 1-based index of the slide to reload.
   * @param outputDir - Directory for temporary output files.
   */
  async reloadSlide(filePath: string, slideIndex: number, outputDir: string): Promise<any> {
    return this.baseProvider.reloadSlide(filePath, slideIndex, outputDir);
  }
}

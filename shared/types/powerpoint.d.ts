import type { SlideIndex } from "../slides/slideCoordinates.js";
import type { Result } from "./result.js";

/**
 * What the renderer asks of PowerPoint, and what it hears back. These live
 * beside the other shared contracts so the renderer and the preload bridge
 * never reach into an Electron implementation module for them.
 */
export type BasicPptResult = Result;

export type VideoPptResult = Result<{ outputPath: string }>;

export type GenerateVideoRequest = {
  filePath: string;
  videoOutputPath: string;
};

export type PlaySlideRequest = {
  filePath: string;
  slideIndex: SlideIndex;
};

export type ReloadSlideRequest = {
  filePath: string;
  slideIndex: SlideIndex;
};

export type RemoveAudioRequest = {
  filePath: string;
  slideIndices: SlideIndex[];
};

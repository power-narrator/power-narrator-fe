import type { SlideIndex } from "../slides/slideCoordinates.js";
import type { Result } from "./result.js";

/**
 * What the renderer asks of PowerPoint, and what it hears back. These live
 * beside the other shared contracts so the renderer and the preload bridge
 * never reach into an Electron implementation module for them.
 */
export type BasicPptResult = Result;

export type VideoPptResult = Result<{ outputPath: string }>;

export type SetGcpKeyResult = Result<{ path: string }>;

export interface GenerateVideoRequest {
  filePath: string;
  videoOutputPath: string;
}

export interface PlaySlideRequest {
  filePath: string;
  slideIndex: SlideIndex;
}

export interface ReloadSlideRequest {
  filePath: string;
  slideIndex: SlideIndex;
}

export interface RemoveAudioRequest {
  filePath: string;
  slideIndices: SlideIndex[];
}

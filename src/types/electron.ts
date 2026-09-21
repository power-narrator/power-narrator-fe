import type {
  BasicPptResult,
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  SetGcpKeyResult as PlatformSetGcpKeyResult,
  VideoPptResult,
} from "../../electron/platform/types";
import type {
  StructuredSlide,
  StructuredSlideResult,
  StructuredSlidesResult,
} from "../../shared/types/slides.js";

export type Slide = StructuredSlide;

export type ConvertResponse = StructuredSlidesResult;

export type BasicElectronResult = BasicPptResult;

export type SlideElectronResult = StructuredSlideResult;

export type VideoElectronResult = VideoPptResult;

export type SetGcpKeyResult = PlatformSetGcpKeyResult;

export type GenerateVideoPayload = GenerateVideoRequest;

export type PlaySlidePayload = PlaySlideRequest;

export type ReloadSlidePayload = ReloadSlideRequest;

export type RemoveAudioPayload = RemoveAudioRequest;

import type {
  BasicPptResult,
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  SlidePptResult,
  SlideAudioEntry as PlatformSlideAudioEntry,
  SlideManifestEntry,
  SlideWithSrc,
  SlidesPptResult,
  SetGcpKeyResult as PlatformSetGcpKeyResult,
  VideoPptResult,
} from "../../electron/platform/types";

export interface Slide extends SlideWithSrc {}

export type ConvertResponse = SlidesPptResult;

export type BasicElectronResult = BasicPptResult;

export type SlidesElectronResult = SlidesPptResult;

export type SlideElectronResult = SlidePptResult;

export type VideoElectronResult = VideoPptResult;

export type SetGcpKeyResult = PlatformSetGcpKeyResult;

export interface SlideAudioEntry extends PlatformSlideAudioEntry {}

export interface SaveNotesSlide extends SlideManifestEntry {}

export interface GenerateVideoPayload extends GenerateVideoRequest {}

export interface PlaySlidePayload extends PlaySlideRequest {}

export interface ReloadSlidePayload extends ReloadSlideRequest {}

export interface RemoveAudioPayload extends RemoveAudioRequest {}

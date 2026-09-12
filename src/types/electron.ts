import type {
  BasicPptResult,
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  SlidePptResult,
  SlideManifestEntry,
  SlideWithSrc,
  SlidesPptResult,
  SetGcpKeyResult as PlatformSetGcpKeyResult,
  VideoPptResult,
} from "../../electron/platform/types";

export type Slide = SlideWithSrc;

export type ConvertResponse = SlidesPptResult;

export type BasicElectronResult = BasicPptResult;

export type SlidesElectronResult = SlidesPptResult;

export type SlideElectronResult = SlidePptResult;

export type VideoElectronResult = VideoPptResult;

export type SetGcpKeyResult = PlatformSetGcpKeyResult;

export type SaveNotesSlide = SlideManifestEntry;

export type GenerateVideoPayload = GenerateVideoRequest;

export type PlaySlidePayload = PlaySlideRequest;

export type ReloadSlidePayload = ReloadSlideRequest;

export type RemoveAudioPayload = RemoveAudioRequest;

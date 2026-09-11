import type { TtsProviderId, Voice } from "../../shared/types/tts.js";

export type { TtsProviderId, Voice } from "../../shared/types/tts.js";

export type CacheIdentityValue =
  | null
  | boolean
  | number
  | string
  | readonly CacheIdentityValue[]
  | { readonly [key: string]: CacheIdentityValue };

export interface AudioEncoding {
  /** Cache filename extension for this encoding, without a leading dot. */
  fileExtension: string;
  mediaType: string;
}

export interface PreparedSpeechRequest {
  cacheIdentity: CacheIdentityValue;
  encoding: AudioEncoding;
  synthesize(): Promise<Uint8Array | Buffer>;
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mediaType: string;
}

export interface TtsProvider {
  getVoices(): Promise<Voice[]>;
  prepareSpeech(text: string, voice: Voice): PreparedSpeechRequest;
}

export type TtsProviderRegistry = ReadonlyMap<TtsProviderId, TtsProvider>;

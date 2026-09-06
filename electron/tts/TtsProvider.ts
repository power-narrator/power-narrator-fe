import type { TtsProviderId, Voice } from "../../shared/types/tts.js";

export type { TtsProviderId, Voice } from "../../shared/types/tts.js";

export type CacheIdentityValue =
  | null
  | boolean
  | number
  | string
  | readonly CacheIdentityValue[]
  | { readonly [key: string]: CacheIdentityValue };

export interface PreparedSpeechRequest {
  cacheIdentity: CacheIdentityValue;
  synthesize(): Promise<Uint8Array | Buffer>;
}

export interface TtsProvider {
  getVoices(): Promise<Voice[]>;
  prepareSpeech(text: string, voice: Voice): PreparedSpeechRequest;
}

export type TtsProviderRegistry = ReadonlyMap<TtsProviderId, TtsProvider>;

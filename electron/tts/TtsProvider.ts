import type { TtsProviderId, Voice, VoiceOption } from "../../shared/types/tts.js";

export type {
  SpeakerMapping,
  TtsProviderId,
  Voice,
  VoiceLanguage,
  VoiceModel,
  VoiceOption,
} from "../../shared/types/tts.js";

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

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mediaType: string;
}

export interface TtsProvider {
  getVoices: () => Promise<VoiceOption[]>;
  prepareSpeech: (text: string, voice: Voice) => PreparedSpeechRequest;
}

export type TtsProviderRegistry = ReadonlyMap<TtsProviderId, TtsProvider>;

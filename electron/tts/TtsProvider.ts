import type { TtsProviderId, Voice } from "../../shared/types/tts.js";

export type { TtsProviderId, Voice } from "../../shared/types/tts.js";

export interface TtsProvider {
  getVoices(): Promise<Voice[]>;
  generateSpeech(text: string, voiceOption?: Voice): Promise<Uint8Array | Buffer | null>;
}

export type TtsProviderRegistry = ReadonlyMap<TtsProviderId, TtsProvider>;

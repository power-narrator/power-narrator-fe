import type { Voice, VoiceOption } from "../../shared/types/tts.js";

export type { Voice, VoiceOption } from "../../shared/types/tts.js";

export interface TtsProvider {
  getVoices(): Promise<Voice[]>;
  generateSpeech(text: string, voiceOption?: VoiceOption): Promise<Uint8Array | Buffer | null>;
}

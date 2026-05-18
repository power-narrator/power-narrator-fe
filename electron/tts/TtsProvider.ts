export interface VoiceOption {
  name: string;
  ssmlGender: string;
  languageCodes: string[];
  provider: string;
  [key: string]: any;
}

export interface TtsProvider {
  getVoices(): Promise<VoiceOption[]>;
  generateSpeech(
    text: string,
    voiceOption: VoiceOption,
  ): Promise<Uint8Array | Buffer | null>;
  formatText(text: string, voiceOption?: VoiceOption): string | { isSsml: boolean; content: string };
}

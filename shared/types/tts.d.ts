export interface VoiceOption {
  name: string;
  languageCodes: string[];
  ssmlGender: string;
  provider?: string;
}

export interface Voice extends VoiceOption {
  provider: string;
}

export interface GenerateSpeechRequest {
  text: string;
  voiceOption?: VoiceOption;
}

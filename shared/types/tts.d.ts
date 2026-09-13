export type TtsProviderId = string;

export interface VoiceLanguage {
  code: string;
  label: string;
}

export interface VoiceModel {
  id: string;
  label: string;
  supportsPrompt: boolean;
  languages: VoiceLanguage[];
}

export interface VoiceOption {
  provider: TtsProviderId;
  name: string;
  ssmlGender: string;
  models: VoiceModel[];
}

export interface Voice {
  provider: TtsProviderId;
  voiceId: string;
  model: string;
  languageCode: string;
  supportsPrompt: boolean;
}

export interface SpeakerMapping {
  voice?: Voice;
  prompt?: string;
}

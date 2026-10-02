export type TtsProviderId = string;

export type VoiceLanguage = {
  code: string;
  label: string;
};

export type VoiceModel = {
  id: string;
  label: string;
  supportsPrompt: boolean;
  languages: VoiceLanguage[];
};

export type VoiceOption = {
  provider: TtsProviderId;
  name: string;
  ssmlGender: string;
  models: VoiceModel[];
};

export type Voice = {
  provider: TtsProviderId;
  voiceId: string;
  model: string;
  languageCode: string;
  supportsPrompt: boolean;
};

export type SpeakerMapping = {
  voice?: Voice;
  prompt?: string;
};

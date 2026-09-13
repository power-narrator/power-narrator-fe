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

/** A catalogue entry offered to the picker. Never persisted. */
export interface VoiceOption {
  provider: TtsProviderId;
  name: string;
  ssmlGender: string;
  models: VoiceModel[];
}

/** A fully made voice choice: persisted, and handed to a provider verbatim. */
export interface Voice {
  provider: TtsProviderId;
  voiceId: string;
  model: string;
  languageCode: string;
  supportsPrompt: boolean;
}

/**
 * Incompleteness is the absence of a voice, never a voice with holes in it, so
 * a partly made selection cannot be stored.
 */
export interface SpeakerMapping {
  voice?: Voice;
  prompt?: string;
}

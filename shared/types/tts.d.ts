export type TtsProviderId = "gcp" | "local";

export interface Voice {
  name: string;
  languageCodes: string[];
  ssmlGender: string;
  provider: TtsProviderId;
}

export type GenerateSpeechRequest = {
  text: string;
  voiceOption?: Voice;
};

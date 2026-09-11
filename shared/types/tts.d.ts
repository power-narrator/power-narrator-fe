export type TtsProviderId = string;

export interface Voice {
  name: string;
  languageCodes: string[];
  ssmlGender: string;
  provider: TtsProviderId;
}

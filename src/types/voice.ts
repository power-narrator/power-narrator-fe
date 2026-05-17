export interface Voice {
  name: string;
  languageCodes: string[];
  ssmlGender: string;
  provider: string;
  displayName?: string;
  voiceId?: string;
}

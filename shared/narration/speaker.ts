/**
 * Declared once so the renderer's speaker list and the main process's voice
 * lookup cannot drift apart.
 */
export const DEFAULT_SPEAKER_KEY = "_default_";

export const DEFAULT_SPEAKER_VALUE = "";

export const DEFAULT_SPEAKER_LABEL = "Default";

export interface SynthesisSpeaker {
  mappingKey: string;
  label: string;
}

export function toSynthesisSpeaker(speaker: string): SynthesisSpeaker {
  return speaker
    ? { mappingKey: speaker, label: speaker }
    : { mappingKey: DEFAULT_SPEAKER_KEY, label: DEFAULT_SPEAKER_LABEL };
}

export function getSpeakerNames(mappings: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(mappings).filter((key) => key !== DEFAULT_SPEAKER_KEY);
}

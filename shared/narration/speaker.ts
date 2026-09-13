/**
 * Declared once so the renderer's speaker list and the main process's voice
 * lookup cannot drift apart.
 */
export const DEFAULT_SPEAKER_KEY = "_default_";

/** The section-level value standing for "no explicitly selected speaker". */
export const DEFAULT_SPEAKER_VALUE = "";

export const DEFAULT_SPEAKER_LABEL = "Default";

/**
 * A speaker selected for synthesis in the two forms narration preparation
 * needs: the key its voice is mapped under, and the label shown to a human.
 */
export interface SynthesisSpeaker {
  mappingKey: string;
  label: string;
}

export function toSynthesisSpeaker(speaker: string): SynthesisSpeaker {
  return speaker
    ? { mappingKey: speaker, label: speaker }
    : { mappingKey: DEFAULT_SPEAKER_KEY, label: DEFAULT_SPEAKER_LABEL };
}

/**
 * The mapping names the notes grammar can recognise as speaker tags. The
 * default speaker is keyed, not named, so it is not one an author can write.
 */
export function getSpeakerNames(mappings: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(mappings).filter((key) => key !== DEFAULT_SPEAKER_KEY);
}

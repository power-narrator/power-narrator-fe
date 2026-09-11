/**
 * Declared once so the renderer's speaker list and the main process's voice
 * lookup cannot drift apart.
 */
export const DEFAULT_SPEAKER_KEY = "_default_";

/** The section-level value standing for "no explicitly selected speaker". */
export const DEFAULT_SPEAKER_VALUE = "";

export const DEFAULT_SPEAKER_LABEL = "Default";

/**
 * An **Effective speaker** in the two forms callers need: the key its voice is
 * mapped under, and the label shown to a human.
 */
export interface EffectiveSpeaker {
  mappingKey: string;
  label: string;
}

export function toEffectiveSpeaker(speaker: string): EffectiveSpeaker {
  return speaker
    ? { mappingKey: speaker, label: speaker }
    : { mappingKey: DEFAULT_SPEAKER_KEY, label: DEFAULT_SPEAKER_LABEL };
}

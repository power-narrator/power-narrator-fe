/**
 * The speaker-mapping key under which the **Default voice** is configured. Both
 * processes resolve unspecified speakers through this one key, so the renderer's
 * speaker list and the main process's voice lookup cannot drift apart.
 */
export const DEFAULT_SPEAKER_KEY = "_default_";

/** The section-level speaker value meaning "no explicitly selected speaker". */
export const DEFAULT_SPEAKER_VALUE = "";

/** How the **Default voice** is named in the UI and in narration failure messages. */
export const DEFAULT_SPEAKER_LABEL = "Default";

/**
 * An **Effective speaker** resolved to the two forms callers need: the key its
 * voice is mapped under, and the label shown to a human.
 */
export interface EffectiveSpeaker {
  /** Key into the speaker mappings; {@link DEFAULT_SPEAKER_KEY} when unspecified. */
  mappingKey: string;
  /** Human-readable name; {@link DEFAULT_SPEAKER_LABEL} when unspecified. */
  label: string;
}

/** Resolves a possibly empty speaker name into its mapping key and label. */
export function toEffectiveSpeaker(speaker: string): EffectiveSpeaker {
  return speaker
    ? { mappingKey: speaker, label: speaker }
    : { mappingKey: DEFAULT_SPEAKER_KEY, label: DEFAULT_SPEAKER_LABEL };
}

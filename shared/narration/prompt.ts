/**
 * An absent prompt and an empty one are the same thing everywhere: neither is
 * stored nor sent to a provider. Declared once so the settings form, narration
 * preparation, and the providers cannot disagree over what counts as empty —
 * a disagreement an author would read as a prompt that is set yet ignored.
 */
export function toSpeakerPrompt(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined;
}

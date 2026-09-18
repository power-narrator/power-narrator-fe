export function toSpeakerPrompt(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined;
}

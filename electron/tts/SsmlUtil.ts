export function isSsml(text: string): boolean {
  return /<[^>]+>/.test(text);
}

export function ensureSpeakElement(text: string): string {
  const trimmedText = text.trim();
  if (trimmedText.startsWith("<speak>")) {
    return trimmedText;
  }

  return `<speak>${trimmedText}</speak>`;
}

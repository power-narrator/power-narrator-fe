export class SsmlUtil {
  static isSsml(text: string): boolean {
    return /<[^>]+>/.test(text);
  }

  static ensureSpeakElement(text: string): string {
    const trimmedText = text.trim();
    if (trimmedText.startsWith("<speak>")) {
      return trimmedText;
    }

    return `<speak>${trimmedText}</speak>`;
  }

  static removeInvalidXmlControlCharacters(text: string): string {
    return Array.from(text, (character) => {
      const characterCode = character.charCodeAt(0);
      const isAllowedWhitespace =
        characterCode === 0x09 || characterCode === 0x0a || characterCode === 0x0d;
      return isAllowedWhitespace || characterCode >= 0x20 ? character : "";
    }).join("");
  }
}

export class SsmlUtil {
  /**
   * Detects if the provided text contains any XML-like tags indicating it might be SSML.
   */
  static isSsml(text: string): boolean {
    return /<[^>]+>/.test(text);
  }
}

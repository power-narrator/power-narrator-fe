export class SsmlUtil {
    /**
     * Detects if the provided text contains any XML-like tags indicating it might be SSML.
     */
    static isSsml(text: string): boolean {
        return /<[^>]+>/.test(text);
    }


    /**
     * Formats text for GCP TTS. Determines if the input is plain text or SSML.
     * If SSML, guarantees it is wrapped in <speak> tags.
     */
    static formatForGcp(text: string): { isSsml: boolean, content: string } {
        const hasTags = this.isSsml(text);
        if (hasTags) {
            let ssmlText = text.trim();
            if (!ssmlText.startsWith('<speak>')) {
                ssmlText = `<speak>${ssmlText}</speak>`;
            }
            return { isSsml: true, content: ssmlText };
        }
        return { isSsml: false, content: text };
    }

    /**
     * Formats text for Local TTS. Guarantees the output is valid SSML wrapped in <speak>.
     * If no SSML tags are present, wraps the plain text in the requested <voice> tag.
     */
    static formatForLocal(text: string, voiceName: string): string {
        const hasTags = this.isSsml(text);
        let ssmlBody = text.trim();

        if (!hasTags) {
            ssmlBody = `<speak><voice name="${voiceName}">${ssmlBody}</voice></speak>`;
        } else if (!ssmlBody.startsWith('<speak>')) {
            ssmlBody = `<speak>${ssmlBody}</speak>`;
        }

        return ssmlBody;
    }
}

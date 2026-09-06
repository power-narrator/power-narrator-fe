import type { PreparedSpeechRequest, TtsProvider, Voice } from "./TtsProvider.js";
import { SsmlUtil } from "./SsmlUtil.js";

export class LocalTtsProvider implements TtsProvider {
  async getVoices(): Promise<Voice[]> {
    return [
      { name: "en_UK/apope_low", ssmlGender: "MALE", languageCodes: ["en-GB"], provider: "local" },
      {
        name: "en_US/cmu-arctic_low",
        ssmlGender: "NEUTRAL",
        languageCodes: ["en-US"],
        provider: "local",
      },
      { name: "default", ssmlGender: "NEUTRAL", languageCodes: ["en-US"], provider: "local" },
    ];
  }

  prepareSpeech(text: string, voiceOption?: Voice): PreparedSpeechRequest {
    const localUrl = process.env.LOCAL_TTS_URL || "http://localhost:59125/api/tts";
    const defaultVoice = process.env.LOCAL_TTS_VOICE || "en_UK/apope_low";
    const voiceName = voiceOption?.name;
    const voice = voiceName && voiceName !== "default" ? voiceName : defaultVoice;

    const url = new URL(localUrl);
    url.searchParams.set("voice", voice);
    url.searchParams.set("ssml", "true");

    const body = this.formatBody(text);
    const requestInit = {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    } as const;

    return {
      cacheIdentity: { url: url.toString(), body, audioEncoding: "WAV" },
      synthesize: async () => {
        const resp = await fetch(url.toString(), requestInit);
        if (!resp.ok) {
          throw new Error(`Local TTS failed: ${resp.status} ${resp.statusText}`);
        }

        const arrayBuffer = await resp.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      },
    };
  }

  private formatBody(text: string): string {
    return SsmlUtil.removeInvalidXmlControlCharacters(SsmlUtil.ensureSpeakElement(text));
  }
}

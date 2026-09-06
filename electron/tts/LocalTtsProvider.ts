import type { PreparedSpeechRequest, TtsProvider, Voice } from "./TtsProvider.js";
import { SsmlUtil } from "./SsmlUtil.js";

export class LocalTtsProvider implements TtsProvider {
  async getVoices(): Promise<Voice[]> {
    const knownVoices: Voice[] = [
      { name: "en_UK/apope_low", ssmlGender: "MALE", languageCodes: ["en-GB"], provider: "local" },
      {
        name: "en_US/cmu-arctic_low",
        ssmlGender: "NEUTRAL",
        languageCodes: ["en-US"],
        provider: "local",
      },
    ];
    const configuredVoiceName = process.env.LOCAL_TTS_VOICE || "en_UK/apope_low";

    if (!knownVoices.some((voice) => voice.name === configuredVoiceName)) {
      knownVoices.push({
        name: configuredVoiceName,
        ssmlGender: "NEUTRAL",
        languageCodes: ["en-US"],
        provider: "local",
      });
    }

    return knownVoices;
  }

  prepareSpeech(text: string, voice: Voice): PreparedSpeechRequest {
    const localUrl = process.env.LOCAL_TTS_URL || "http://localhost:59125/api/tts";

    const url = new URL(localUrl);
    url.searchParams.set("voice", voice.name);
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
        if (arrayBuffer.byteLength === 0) {
          throw new Error("Local TTS returned no audio content");
        }

        return new Uint8Array(arrayBuffer);
      },
    };
  }

  private formatBody(text: string): string {
    return SsmlUtil.removeInvalidXmlControlCharacters(SsmlUtil.ensureSpeakElement(text));
  }
}

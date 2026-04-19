import { TtsProvider, VoiceOption } from "./TtsProvider.js";
import { SsmlUtil } from "./SsmlUtil.js";

export class LocalTtsProvider implements TtsProvider {
  async getVoices(): Promise<VoiceOption[]> {
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

  async generateSpeech(text: string, voiceOption: VoiceOption | null): Promise<Uint8Array | null> {
    const localUrl = process.env.LOCAL_TTS_URL || "http://localhost:59125/api/tts";
    const defaultVoice = process.env.LOCAL_TTS_VOICE || "en_UK/apope_low";
    const voiceName = voiceOption?.name;
    const voice = voiceName && voiceName !== "default" ? voiceName : defaultVoice;

    const ssmlBody = SsmlUtil.formatForLocal(text, voice);

    const url = new URL(localUrl);
    url.searchParams.append("voice", voice);
    url.searchParams.append("ssml", "true");

    const sanitizedText = ssmlBody.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sanitizedText,
    });

    if (!resp.ok) {
      throw new Error(`Local TTS failed: ${resp.status} ${resp.statusText}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}

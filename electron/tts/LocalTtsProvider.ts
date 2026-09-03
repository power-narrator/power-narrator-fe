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

  formatText(text: string, voiceOption?: VoiceOption): string {
    const hasTags = SsmlUtil.isSsml(text);
    let ssmlBody = text.trim();
    const voiceName = voiceOption?.name || "default";

    if (!hasTags) {
      ssmlBody = `<speak><voice name="${voiceName}">${ssmlBody}</voice></speak>`;
    } else if (!ssmlBody.startsWith("<speak>")) {
      ssmlBody = `<speak>${ssmlBody}</speak>`;
    }

    return ssmlBody;
  }

  async generateSpeech(text: string, voiceOption: VoiceOption): Promise<Uint8Array | null> {
    const localUrl = process.env.LOCAL_TTS_URL || "http://localhost:59125/api/tts";
    const defaultVoice = process.env.LOCAL_TTS_VOICE || "en_UK/apope_low";
    const voiceName = voiceOption?.name;
    const voice = voiceName && voiceName !== "default" ? voiceName : defaultVoice;

    const ssmlBody = this.formatText(text, voiceOption ? { ...voiceOption, name: voice } : { name: voice, languageCodes: [], ssmlGender: '', provider: 'local' });

    const url = new URL(localUrl);
    url.searchParams.append("voice", voice);
    url.searchParams.append("ssml", "true");

    // eslint-disable-next-line no-control-regex
    const sanitizedText = ssmlBody.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

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

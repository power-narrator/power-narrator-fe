import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import type { TtsProvider, Voice } from "./TtsProvider.js";
import { SsmlUtil } from "./SsmlUtil.js";

type GcpVoice = {
  name?: string | null;
  languageCodes?: string[] | null;
  ssmlGender?: string | number | null;
};

function normalizeVoices(voices: GcpVoice[]): Voice[] {
  return voices.flatMap((voice) => {
    if (
      !voice.name?.includes("Chirp3-HD") ||
      !voice.languageCodes?.length ||
      voice.ssmlGender == null
    ) {
      return [];
    }

    return [
      {
        name: voice.name,
        languageCodes: [...voice.languageCodes],
        ssmlGender: String(voice.ssmlGender),
        provider: "gcp",
      },
    ];
  });
}

export class GcpTtsProvider implements TtsProvider {
  constructor(private keyPathProvider: () => string | undefined) {}

  async getVoices(): Promise<Voice[]> {
    const keyPath = this.keyPathProvider();
    if (!keyPath) {
      console.warn("GOOGLE_APPLICATION_CREDENTIALS is not set; skipping GCP voices.");
      return [];
    }

    const client = new TextToSpeechClient({ keyFilename: keyPath });
    const voices: Voice[] = [];

    try {
      const [gbResult] = await client.listVoices({ languageCode: "en-GB" });
      voices.push(...normalizeVoices(gbResult.voices ?? []));

      const [usResult] = await client.listVoices({ languageCode: "en-US" });
      voices.push(...normalizeVoices(usResult.voices ?? []));
    } catch (error) {
      console.error("Failed to list GCP voices:", error);
    }

    return voices;
  }

  async generateSpeech(text: string, voiceOption?: Voice): Promise<Uint8Array | null> {
    const keyPath = this.keyPathProvider();
    if (!keyPath) {
      throw new Error("GCP TTS requested but GOOGLE_APPLICATION_CREDENTIALS is not set");
    }

    const client = new TextToSpeechClient({ keyFilename: keyPath });
    const [response] = await client.synthesizeSpeech({
      input: this.formatInput(text),
      voice: voiceOption
        ? { languageCode: voiceOption.languageCodes[0], name: voiceOption.name }
        : { languageCode: "en-US", name: "en-US-Journey-F" },
      audioConfig: { audioEncoding: "MP3" },
    });
    if (!response.audioContent) {
      return null;
    }

    return typeof response.audioContent === "string"
      ? Buffer.from(response.audioContent, "base64")
      : response.audioContent;
  }

  private formatInput(text: string): { text: string } | { ssml: string } {
    return SsmlUtil.isSsml(text) ? { ssml: SsmlUtil.ensureSpeakElement(text) } : { text };
  }
}

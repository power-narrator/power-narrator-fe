import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import type {
  PreparedSpeechRequest,
  TtsProvider,
  Voice,
  VoiceModel,
  VoiceOption,
} from "./TtsProvider.js";
import { ensureSpeakElement, isSsml } from "./SsmlUtil.js";

type GcpVoice = {
  name?: string | null;
  languageCodes?: string[] | null;
  ssmlGender?: string | number | null;
};

export const CHIRP_3_HD_MODEL = "chirp-3-hd";

const MODELS: Record<string, { label: string; supportsPrompt: boolean }> = {
  [CHIRP_3_HD_MODEL]: { label: "Chirp 3 HD", supportsPrompt: false },
};

const CHIRP_3_HD_PATTERN =
  /^(?<languageCode>[a-z]{2,3}(?:-[A-Za-z0-9]+)*)-Chirp3-HD-(?<voiceId>.+)$/;

export type VoiceComposition = Omit<Voice, "provider">;

/**
 * Standalone so catalogue shaping and the settings migration share one grammar
 * without constructing a provider, which needs credentials they do not have.
 */
export function decomposeGcpVoiceName(name: string): VoiceComposition | null {
  const groups = CHIRP_3_HD_PATTERN.exec(name)?.groups;
  if (!groups?.voiceId || !groups.languageCode) {
    return null;
  }

  return {
    voiceId: groups.voiceId,
    model: CHIRP_3_HD_MODEL,
    languageCode: groups.languageCode,
    supportsPrompt: MODELS[CHIRP_3_HD_MODEL]!.supportsPrompt,
  };
}

function composeGcpVoiceName(voice: Voice): string {
  if (voice.model !== CHIRP_3_HD_MODEL) {
    throw new Error(`GCP TTS cannot synthesize the model '${voice.model}'`);
  }

  return `${voice.languageCode}-Chirp3-HD-${voice.voiceId}`;
}

function toVoiceOptions(voices: GcpVoice[]): VoiceOption[] {
  return voices.flatMap((voice) => {
    if (!voice.name || !voice.languageCodes?.length || voice.ssmlGender == null) {
      return [];
    }

    const composition = decomposeGcpVoiceName(voice.name);
    if (!composition) {
      return [];
    }

    const model = MODELS[composition.model];
    if (!model) {
      return [];
    }

    const voiceModel: VoiceModel = {
      id: composition.model,
      label: model.label,
      supportsPrompt: model.supportsPrompt,
      languages: [{ code: composition.languageCode, label: composition.languageCode }],
    };

    return [
      {
        provider: "gcp",
        name: composition.voiceId,
        ssmlGender: String(voice.ssmlGender),
        models: [voiceModel],
      },
    ];
  });
}

export class GcpTtsProvider implements TtsProvider {
  constructor(private keyPathProvider: () => string | undefined) {}

  async getVoices(): Promise<VoiceOption[]> {
    const keyPath = this.keyPathProvider();
    if (!keyPath) {
      console.warn("GOOGLE_APPLICATION_CREDENTIALS is not set; skipping GCP voices.");
      return [];
    }

    const client = new TextToSpeechClient({ keyFilename: keyPath });
    const options: VoiceOption[] = [];

    try {
      const [gbResult] = await client.listVoices({ languageCode: "en-GB" });
      options.push(...toVoiceOptions(gbResult.voices ?? []));

      const [usResult] = await client.listVoices({ languageCode: "en-US" });
      options.push(...toVoiceOptions(usResult.voices ?? []));
    } catch (error) {
      console.error("Failed to list GCP voices:", error);
    }

    return options;
  }

  prepareSpeech(text: string, voice: Voice): PreparedSpeechRequest {
    const request = {
      input: this.formatInput(text),
      voice: { languageCode: voice.languageCode, name: composeGcpVoiceName(voice) },
      audioConfig: { audioEncoding: "MP3" },
    } as const;

    return {
      cacheIdentity: request,
      synthesize: async () => {
        const keyPath = this.keyPathProvider();
        if (!keyPath) {
          throw new Error("GCP TTS requested but GOOGLE_APPLICATION_CREDENTIALS is not set");
        }

        const client = new TextToSpeechClient({ keyFilename: keyPath });
        let response;
        try {
          [response] = await client.synthesizeSpeech(request);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown synthesis error";
          throw new Error(`GCP TTS failed: ${message}`, { cause: error });
        }

        if (!response.audioContent || response.audioContent.length === 0) {
          throw new Error("GCP TTS returned no audio content");
        }

        return typeof response.audioContent === "string"
          ? Buffer.from(response.audioContent, "base64")
          : response.audioContent;
      },
    };
  }

  private formatInput(text: string): { text: string } | { ssml: string } {
    return isSsml(text) ? { ssml: ensureSpeakElement(text) } : { text };
  }
}

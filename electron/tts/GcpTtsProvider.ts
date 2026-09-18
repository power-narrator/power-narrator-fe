import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import type {
  PreparedSpeechRequest,
  TtsProvider,
  Voice,
  VoiceLanguage,
  VoiceModel,
  VoiceOption,
} from "./TtsProvider.js";
import { ensureSpeakElement, isSsml } from "./SsmlUtil.js";
import { GEMINI_LANGUAGES } from "./gcpLanguages.js";
import { toSpeakerPrompt } from "../../shared/narration/prompt.js";

type GcpVoice = {
  name?: string | null;
  languageCodes?: string[] | null;
  ssmlGender?: string | number | null;
};

export const CHIRP_3_HD_MODEL = "chirp-3-hd";

type ModelDefinition = {
  label: string;
  supportsPrompt: boolean;
  requestModelName: string | null;
  documentedLanguages: VoiceLanguage[] | null;
};

const MODELS: Record<string, ModelDefinition> = {
  [CHIRP_3_HD_MODEL]: {
    label: "Chirp 3 HD",
    supportsPrompt: false,
    requestModelName: null,
    documentedLanguages: null,
  },
  "gemini-2.5-pro-tts": {
    label: "Gemini 2.5 Pro",
    supportsPrompt: true,
    requestModelName: "gemini-2.5-pro-tts",
    documentedLanguages: GEMINI_LANGUAGES,
  },
  "gemini-2.5-flash-tts": {
    label: "Gemini 2.5 Flash",
    supportsPrompt: true,
    requestModelName: "gemini-2.5-flash-tts",
    documentedLanguages: GEMINI_LANGUAGES,
  },
  "gemini-2.5-flash-lite-preview-tts": {
    label: "Gemini 2.5 Flash Lite (Preview)",
    supportsPrompt: true,
    requestModelName: "gemini-2.5-flash-lite-preview-tts",
    documentedLanguages: GEMINI_LANGUAGES,
  },
  "gemini-3.1-flash-tts-preview": {
    label: "Gemini 3.1 Flash (Preview)",
    supportsPrompt: true,
    requestModelName: "gemini-3.1-flash-tts-preview",
    documentedLanguages: GEMINI_LANGUAGES,
  },
};

const GEMINI_MODELS = Object.keys(MODELS).filter((id) => id !== CHIRP_3_HD_MODEL);

const CHIRP_3_HD_PATTERN =
  /^(?<languageCode>[a-z]{2,3}(?:-[A-Za-z0-9]+)*)-Chirp3-HD-(?<voiceId>.+)$/;

const GEMINI_VOICE_NAME_PATTERN = /^[^-\s]+$/;

type GcpVoiceDetails = Omit<Voice, "provider">;

function createVoiceDetails(voiceId: string, model: string, languageCode: string): GcpVoiceDetails {
  return {
    voiceId,
    model,
    languageCode,
    supportsPrompt: MODELS[model]!.supportsPrompt,
  };
}

export function parseGcpVoiceName(name: string): GcpVoiceDetails | null {
  const groups = CHIRP_3_HD_PATTERN.exec(name)?.groups;
  if (!groups?.voiceId || !groups.languageCode) {
    return null;
  }

  return createVoiceDetails(groups.voiceId, CHIRP_3_HD_MODEL, groups.languageCode);
}

function interpretCatalogueVoice(name: string, languageCode: string): GcpVoiceDetails[] {
  const chirp = parseGcpVoiceName(name);
  if (chirp) {
    return [chirp];
  }

  return GEMINI_VOICE_NAME_PATTERN.test(name)
    ? GEMINI_MODELS.map((model) => createVoiceDetails(name, model, languageCode))
    : [];
}

function toGcpVoiceName(voice: Voice): string {
  return voice.model === CHIRP_3_HD_MODEL
    ? `${voice.languageCode}-Chirp3-HD-${voice.voiceId}`
    : voice.voiceId;
}

function toVoiceOptions(voices: GcpVoice[]): VoiceOption[] {
  const options = new Map<string, VoiceOption>();

  for (const voice of voices) {
    const languageCode = voice.languageCodes?.[0];
    if (!voice.name || !languageCode || voice.ssmlGender == null) {
      continue;
    }

    const ssmlGender = String(voice.ssmlGender);
    for (const details of interpretCatalogueVoice(voice.name, languageCode)) {
      const key = JSON.stringify([details.voiceId, ssmlGender]);
      let option = options.get(key);
      if (!option) {
        option = {
          provider: "gcp",
          name: details.voiceId,
          ssmlGender,
          models: [],
        };
        options.set(key, option);
      }

      addLanguage(option, details);
    }
  }

  return [...options.values()];
}

function addLanguage(option: VoiceOption, details: GcpVoiceDetails): void {
  const definition = MODELS[details.model]!;
  let model: VoiceModel | undefined = option.models.find(
    (candidate) => candidate.id === details.model,
  );
  if (!model) {
    model = {
      id: details.model,
      label: definition.label,
      supportsPrompt: definition.supportsPrompt,
      languages: definition.documentedLanguages ? [...definition.documentedLanguages] : [],
    };
    option.models.push(model);
  }

  if (
    !definition.documentedLanguages &&
    !model.languages.some((language) => language.code === details.languageCode)
  ) {
    model.languages.push({ code: details.languageCode, label: details.languageCode });
  }
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
    const voices: GcpVoice[] = [];

    try {
      const [gbResult] = await client.listVoices({ languageCode: "en-GB" });
      voices.push(...(gbResult.voices ?? []));

      const [usResult] = await client.listVoices({ languageCode: "en-US" });
      voices.push(...(usResult.voices ?? []));
    } catch (error) {
      console.error("Failed to list GCP voices:", error);
    }

    return toVoiceOptions(voices);
  }

  prepareSpeech(text: string, voice: Voice, prompt?: string): PreparedSpeechRequest {
    const model = MODELS[voice.model];
    if (!model) {
      throw new Error(`GCP TTS cannot synthesize the model '${voice.model}'`);
    }

    const request = {
      input: { ...this.formatInput(text), ...this.formatPrompt(model, prompt) },
      voice: {
        languageCode: voice.languageCode,
        name: toGcpVoiceName(voice),
        ...(model.requestModelName ? { modelName: model.requestModelName } : {}),
      },
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

  private formatPrompt(model: ModelDefinition, prompt: string | undefined): { prompt?: string } {
    const speakerPrompt = model.supportsPrompt ? toSpeakerPrompt(prompt) : undefined;

    return speakerPrompt ? { prompt: speakerPrompt } : {};
  }
}

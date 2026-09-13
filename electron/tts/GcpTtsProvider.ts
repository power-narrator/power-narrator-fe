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
  /** The value Google's API accepts, or null where the voice identifier implies it. */
  modelName: string | null;
  /** The languages the model documents, or null where the catalogue advertises them. */
  languages: VoiceLanguage[] | null;
};

/**
 * A model id is this app's identity for a model and is not always a legal
 * `modelName`: Chirp 3 HD names no model in the request and would be rejected
 * if it did.
 */
const MODELS: Record<string, ModelDefinition> = {
  [CHIRP_3_HD_MODEL]: {
    label: "Chirp 3 HD",
    supportsPrompt: false,
    modelName: null,
    languages: null,
  },
  "gemini-2.5-pro-tts": {
    label: "Gemini 2.5 Pro",
    supportsPrompt: true,
    modelName: "gemini-2.5-pro-tts",
    languages: GEMINI_LANGUAGES,
  },
  "gemini-2.5-flash-tts": {
    label: "Gemini 2.5 Flash",
    supportsPrompt: true,
    modelName: "gemini-2.5-flash-tts",
    languages: GEMINI_LANGUAGES,
  },
  "gemini-2.5-flash-lite-preview-tts": {
    label: "Gemini 2.5 Flash Lite (Preview)",
    supportsPrompt: true,
    modelName: "gemini-2.5-flash-lite-preview-tts",
    languages: GEMINI_LANGUAGES,
  },
  "gemini-3.1-flash-tts-preview": {
    label: "Gemini 3.1 Flash (Preview)",
    supportsPrompt: true,
    modelName: "gemini-3.1-flash-tts-preview",
    languages: GEMINI_LANGUAGES,
  },
};

/** Every model whose identity the catalogue never spells out, Chirp 3 HD being the only one it does. */
const GEMINI_MODELS = Object.keys(MODELS).filter((id) => id !== CHIRP_3_HD_MODEL);

const CHIRP_3_HD_PATTERN =
  /^(?<languageCode>[a-z]{2,3}(?:-[A-Za-z0-9]+)*)-Chirp3-HD-(?<voiceId>.+)$/;

/** Gemini voices are the ones the catalogue publishes under a bare name. */
const BARE_NAME_PATTERN = /^[^-\s]+$/;

export type VoiceComposition = Omit<Voice, "provider">;

function toComposition(voiceId: string, model: string, languageCode: string): VoiceComposition {
  return {
    voiceId,
    model,
    languageCode,
    supportsPrompt: MODELS[model]!.supportsPrompt,
  };
}

/**
 * Standalone so catalogue shaping and the settings migration share one grammar
 * without constructing a provider, which needs credentials they do not have.
 */
export function decomposeGcpVoiceName(name: string): VoiceComposition | null {
  const groups = CHIRP_3_HD_PATTERN.exec(name)?.groups;
  if (!groups?.voiceId || !groups.languageCode) {
    return null;
  }

  return toComposition(groups.voiceId, CHIRP_3_HD_MODEL, groups.languageCode);
}

/**
 * Every voice a single catalogue entry stands for. A Chirp 3 HD identifier
 * names one model; a bare Gemini name names none, so it stands for every
 * Gemini model, each of which supplies its own documented languages.
 */
function decomposeCatalogueEntry(name: string, languageCode: string): VoiceComposition[] {
  const chirp = decomposeGcpVoiceName(name);
  if (chirp) {
    return [chirp];
  }

  return BARE_NAME_PATTERN.test(name)
    ? GEMINI_MODELS.map((model) => toComposition(name, model, languageCode))
    : [];
}

function composeGcpVoiceName(voice: Voice): string {
  return voice.model === CHIRP_3_HD_MODEL
    ? `${voice.languageCode}-Chirp3-HD-${voice.voiceId}`
    : voice.voiceId;
}

/**
 * Options are grouped by name and gender alone, both read from whatever the
 * catalogue returned: a name several models offer yields one option listing
 * them all, and a name two genders disagree over yields two the label already
 * tells apart.
 */
function toVoiceOptions(voices: GcpVoice[]): VoiceOption[] {
  const options = new Map<string, VoiceOption>();

  for (const voice of voices) {
    const languageCode = voice.languageCodes?.[0];
    if (!voice.name || !languageCode || voice.ssmlGender == null) {
      continue;
    }

    const ssmlGender = String(voice.ssmlGender);
    for (const composition of decomposeCatalogueEntry(voice.name, languageCode)) {
      const key = JSON.stringify([composition.voiceId, ssmlGender]);
      let option = options.get(key);
      if (!option) {
        option = {
          provider: "gcp",
          name: composition.voiceId,
          ssmlGender,
          models: [],
        };
        options.set(key, option);
      }

      addLanguage(option, composition);
    }
  }

  return [...options.values()];
}

/**
 * A model documenting its own languages carries all of them, since the
 * catalogue advertises Gemini voices under one locale that says nothing about
 * what they can speak.
 */
function addLanguage(option: VoiceOption, composition: VoiceComposition): void {
  const definition = MODELS[composition.model]!;
  let model: VoiceModel | undefined = option.models.find(
    (candidate) => candidate.id === composition.model,
  );
  if (!model) {
    model = {
      id: composition.model,
      label: definition.label,
      supportsPrompt: definition.supportsPrompt,
      languages: definition.languages ? [...definition.languages] : [],
    };
    option.models.push(model);
  }

  if (
    !definition.languages &&
    !model.languages.some((language) => language.code === composition.languageCode)
  ) {
    model.languages.push({ code: composition.languageCode, label: composition.languageCode });
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

    // Shaped in one pass so a name offered under both locales collapses into a
    // single option rather than one per request.
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
        name: composeGcpVoiceName(voice),
        ...(model.modelName ? { modelName: model.modelName } : {}),
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

  /**
   * An unusable or absent prompt leaves the field off the request rather than
   * sending an empty one, so the model's own default delivery still applies. A
   * model that cannot be prompted drops it here instead of refusing the
   * synthesis, since the author may have parked it deliberately (ADR 0001).
   */
  private formatPrompt(model: ModelDefinition, prompt: string | undefined): { prompt?: string } {
    const speakerPrompt = model.supportsPrompt ? toSpeakerPrompt(prompt) : undefined;

    return speakerPrompt ? { prompt: speakerPrompt } : {};
  }
}

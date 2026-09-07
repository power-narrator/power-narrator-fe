import type { Voice } from "../tts/TtsProvider.js";
import type {
  NarrationPreparationProgress,
  PreviewNarrationRequest,
} from "../../shared/types/narration.js";
import type { SlideAudioEntry } from "../platform/types.js";
import { getEffectiveSpeaker, parseNarrationSections } from "./NarrationSections.js";

export interface SpeakerMappingSource {
  getSpeakerMappings(): Record<string, Voice> | Promise<Record<string, Voice>>;
}

export interface NarrationSynthesizer {
  supportsProvider(providerId: string): boolean;
  generateSpeech(text: string, voice: Voice): Promise<Uint8Array | Buffer>;
}

const DEFAULT_SPEAKER_KEY = "_default_";

type PreparedNarrationSection = {
  slideIndex: number;
  sectionIndex: number;
  speaker: string;
  text: string;
  voice: Voice;
};

function voiceValidationProblem(voice: Voice | undefined): string | null {
  if (!voice) {
    return "no voice mapping is configured";
  }

  if (
    !voice.name?.trim() ||
    !voice.provider ||
    !voice.languageCodes?.length ||
    !voice.ssmlGender?.trim()
  ) {
    return "the configured voice mapping is empty or incomplete";
  }

  if (voice.name.trim().toLowerCase() === "default") {
    return "the configured voice is a legacy unresolved placeholder";
  }

  return null;
}

export class NarrationPreparation {
  constructor(
    private readonly mappingSource: SpeakerMappingSource,
    private readonly synthesizer: NarrationSynthesizer,
  ) {}

  async preparePreview(request: PreviewNarrationRequest): Promise<Uint8Array | Buffer> {
    const text = request.text.trim();
    if (!text) {
      throw new NarrationPreparationError(
        "validation",
        `Narration validation failed for slide ${request.slideIndex}, section ${request.sectionIndex + 1}: text is empty.`,
      );
    }

    const sections = parseNarrationSections(request.notes);
    const speaker =
      request.previewSpeaker !== undefined
        ? request.previewSpeaker || DEFAULT_SPEAKER_KEY
        : getEffectiveSpeaker(sections, request.sectionIndex) || DEFAULT_SPEAKER_KEY;
    const mappings = await this.mappingSource.getSpeakerMappings();
    const voice = this.resolveVoice(mappings, speaker, request.slideIndex, request.sectionIndex);

    return this.synthesizeSection({
      slideIndex: request.slideIndex,
      sectionIndex: request.sectionIndex,
      speaker,
      text,
      voice,
    });
  }

  async prepareBatch(
    slides: Array<{ slideIndex: number; notes: string }>,
    onProgress?: (progress: NarrationPreparationProgress) => void,
  ): Promise<SlideAudioEntry[]> {
    const mappings = await this.mappingSource.getSpeakerMappings();
    const prepared = slides.flatMap((slide) => {
      const sections = parseNarrationSections(slide.notes);

      return sections.flatMap((section, sectionIndex) => {
        const text = section.text.trim();
        if (!text) {
          return [];
        }

        const speaker = getEffectiveSpeaker(sections, sectionIndex) || DEFAULT_SPEAKER_KEY;
        const voice = this.resolveVoice(mappings, speaker, slide.slideIndex, sectionIndex);

        return [{ slideIndex: slide.slideIndex, sectionIndex, speaker, text, voice }];
      });
    });

    let completed = 0;
    const total = prepared.length;

    return Promise.all(
      prepared.map(async (section) => {
        const audio = await this.synthesizeSection(section);
        const entry = {
          index: section.slideIndex,
          sectionIndex: section.sectionIndex,
          audioData: new Uint8Array(audio),
        };
        completed += 1;
        onProgress?.({ completed, total });
        return entry;
      }),
    );
  }

  private async synthesizeSection(section: PreparedNarrationSection): Promise<Uint8Array | Buffer> {
    try {
      return await this.synthesizer.generateSpeech(section.text, section.voice);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown synthesis error";
      const label = section.speaker === DEFAULT_SPEAKER_KEY ? "Default" : section.speaker;
      throw new NarrationPreparationError(
        "synthesis",
        `Narration synthesis failed for slide ${section.slideIndex}, section ${section.sectionIndex + 1}, speaker "${label}": ${message}.`,
      );
    }
  }

  private resolveVoice(
    mappings: Record<string, Voice>,
    speaker: string,
    slideIndex: number,
    sectionIndex: number,
  ): Voice {
    const voice = mappings[speaker];
    const validationProblem =
      voiceValidationProblem(voice) ||
      (voice && !this.synthesizer.supportsProvider(String(voice.provider))
        ? `voice provider "${String(voice.provider)}" is not registered`
        : null);

    if (validationProblem || !voice) {
      const label = speaker === DEFAULT_SPEAKER_KEY ? "Default" : speaker;
      throw new NarrationPreparationError(
        "validation",
        `Narration validation failed for slide ${slideIndex}, section ${sectionIndex + 1}, speaker "${label}": ${validationProblem}.`,
      );
    }

    return voice;
  }
}

export class NarrationPreparationError extends Error {
  constructor(
    readonly stage: "validation" | "synthesis",
    message: string,
  ) {
    super(message);
    this.name = "NarrationPreparationError";
  }
}

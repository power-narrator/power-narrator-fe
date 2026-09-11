import type { SynthesizedSpeech, Voice } from "../tts/TtsProvider.js";
import type {
  NarrationPreparationProgress,
  PreviewNarrationRequest,
} from "../../shared/types/narration.js";
import type { SlideAudioEntry } from "../platform/types.js";
import {
  getEffectiveSpeaker,
  parseNarrationSections,
} from "../../shared/narration/NarrationSections.js";
import {
  DEFAULT_SPEAKER_VALUE,
  toSynthesisSpeaker,
  type SynthesisSpeaker,
} from "../../shared/narration/speaker.js";

export interface SpeakerMappingSource {
  getSpeakerMappings(): Record<string, Voice> | Promise<Record<string, Voice>>;
}

export interface NarrationSynthesizer {
  supportsProvider(providerId: string): boolean;
  generateSpeech(text: string, voice: Voice): Promise<SynthesizedSpeech>;
}

type PreparedNarrationSection = {
  slideIndex: number;
  sectionIndex: number;
  synthesisSpeaker: SynthesisSpeaker;
  text: string;
  voice: Voice;
};

type SynthesizedNarrationSection = PreparedNarrationSection & {
  speech: SynthesizedSpeech;
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

  async preparePreview(request: PreviewNarrationRequest): Promise<SynthesizedSpeech> {
    const text = request.text.trim();
    if (!text) {
      throw new NarrationPreparationError(
        "validation",
        `Narration validation failed for slide ${request.slideIndex}, section ${request.sectionIndex + 1}: text is empty.`,
      );
    }

    const sections = parseNarrationSections(request.notes);
    const speaker =
      request.speakerChoice.kind === "effective"
        ? getEffectiveSpeaker(sections, request.sectionIndex)
        : request.speakerChoice.kind === "default"
          ? DEFAULT_SPEAKER_VALUE
          : request.speakerChoice.speaker;
    const mappings = await this.mappingSource.getSpeakerMappings();
    const [preview] = await this.synthesizeSections([
      this.planSection(mappings, request.slideIndex, request.sectionIndex, text, speaker),
    ]);

    return preview!.speech;
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

        const speaker = getEffectiveSpeaker(sections, sectionIndex);

        return [this.planSection(mappings, slide.slideIndex, sectionIndex, text, speaker)];
      });
    });

    const synthesized = await this.synthesizeSections(prepared, onProgress);

    return synthesized.map(({ slideIndex, sectionIndex, speech }) => ({
      index: slideIndex,
      sectionIndex,
      audioData: new Uint8Array(speech.audio),
    }));
  }

  /**
   * Resolves one section's selected synthesis speaker and voice, so preview and
   * batch preparation share a single parse-to-synthesizable-section shape.
   */
  private planSection(
    mappings: Record<string, Voice>,
    slideIndex: number,
    sectionIndex: number,
    text: string,
    speaker: string,
  ): PreparedNarrationSection {
    const synthesisSpeaker = toSynthesisSpeaker(speaker);

    return {
      slideIndex,
      sectionIndex,
      synthesisSpeaker,
      text,
      voice: this.resolveVoice(mappings, synthesisSpeaker, slideIndex, sectionIndex),
    };
  }

  private synthesizeSections(
    sections: PreparedNarrationSection[],
    onProgress?: (progress: NarrationPreparationProgress) => void,
  ): Promise<SynthesizedNarrationSection[]> {
    let completed = 0;

    return Promise.all(
      sections.map(async (section) => {
        try {
          const speech = await this.synthesizer.generateSpeech(section.text, section.voice);
          completed += 1;
          onProgress?.({ completed, total: sections.length });
          return { ...section, speech };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown synthesis error";
          throw new NarrationPreparationError(
            "synthesis",
            `Narration synthesis failed for slide ${section.slideIndex}, section ${section.sectionIndex + 1}, speaker "${section.synthesisSpeaker.label}": ${message}.`,
          );
        }
      }),
    );
  }

  private resolveVoice(
    mappings: Record<string, Voice>,
    speaker: SynthesisSpeaker,
    slideIndex: number,
    sectionIndex: number,
  ): Voice {
    const voice = mappings[speaker.mappingKey];
    const validationProblem =
      voiceValidationProblem(voice) ||
      (voice && !this.synthesizer.supportsProvider(String(voice.provider))
        ? `voice provider "${String(voice.provider)}" is not registered`
        : null);

    if (validationProblem || !voice) {
      throw new NarrationPreparationError(
        "validation",
        `Narration validation failed for slide ${slideIndex}, section ${sectionIndex + 1}, speaker "${speaker.label}": ${validationProblem}.`,
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

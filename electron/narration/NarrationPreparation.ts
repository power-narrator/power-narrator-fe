import type { SpeakerMapping, SynthesizedSpeech, Voice } from "../tts/TtsProvider.js";
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
  getSpeakerNames,
  toSynthesisSpeaker,
  type SynthesisSpeaker,
} from "../../shared/narration/speaker.js";
import { toSpeakerPrompt } from "../../shared/narration/prompt.js";

export interface SpeakerMappingSource {
  getSpeakerMappings(): Record<string, SpeakerMapping> | Promise<Record<string, SpeakerMapping>>;
}

export interface NarrationSynthesizer {
  supportsProvider(providerId: string): boolean;
  generateSpeech(text: string, voice: Voice, prompt?: string): Promise<SynthesizedSpeech>;
}

type PreparedNarrationSection = {
  slideIndex: number;
  sectionIndex: number;
  synthesisSpeaker: SynthesisSpeaker;
  text: string;
  voice: Voice;
  prompt?: string;
};

type SynthesizedNarrationSection = PreparedNarrationSection & {
  speech: SynthesizedSpeech;
};

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

    // Classification consults the mapping names, so the mappings must be in hand
    // before the notes can be parsed.
    const mappings = await this.mappingSource.getSpeakerMappings();
    const sections = parseNarrationSections(request.notes, getSpeakerNames(mappings));
    const speaker =
      request.speakerChoice.kind === "effective"
        ? getEffectiveSpeaker(sections, request.sectionIndex)
        : request.speakerChoice.kind === "default"
          ? DEFAULT_SPEAKER_VALUE
          : request.speakerChoice.speaker;
    const [preview] = await this.synthesizeSections([
      this.planSection(
        mappings,
        request.slideIndex,
        request.sectionIndex,
        text,
        speaker,
        sections[request.sectionIndex]?.prompt,
      ),
    ]);

    return preview!.speech;
  }

  async prepareBatch(
    slides: Array<{ slideIndex: number; notes: string }>,
    onProgress?: (progress: NarrationPreparationProgress) => void,
  ): Promise<SlideAudioEntry[]> {
    const mappings = await this.mappingSource.getSpeakerMappings();
    const prepared = slides.flatMap((slide) => {
      const sections = parseNarrationSections(slide.notes, getSpeakerNames(mappings));

      return sections.flatMap((section, sectionIndex) => {
        const text = section.text.trim();
        if (!text) {
          return [];
        }

        const speaker = getEffectiveSpeaker(sections, sectionIndex);

        return [
          this.planSection(mappings, slide.slideIndex, sectionIndex, text, speaker, section.prompt),
        ];
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
    mappings: Record<string, SpeakerMapping>,
    slideIndex: number,
    sectionIndex: number,
    text: string,
    speaker: string,
    inlinePrompt: string | undefined,
  ): PreparedNarrationSection {
    const synthesisSpeaker = toSynthesisSpeaker(speaker);
    const mapping = mappings[synthesisSpeaker.mappingKey];

    return {
      slideIndex,
      sectionIndex,
      synthesisSpeaker,
      text,
      voice: this.resolveVoice(mapping, synthesisSpeaker, slideIndex, sectionIndex),
      prompt: combineSpeakerPrompts(mapping?.prompt, inlinePrompt),
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
          const speech = await this.synthesizer.generateSpeech(
            section.text,
            section.voice,
            section.prompt,
          );
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
    mapping: SpeakerMapping | undefined,
    speaker: SynthesisSpeaker,
    slideIndex: number,
    sectionIndex: number,
  ): Voice {
    const voice = mapping?.voice;
    const validationProblem = !voice
      ? "no voice mapping is configured"
      : !this.synthesizer.supportsProvider(voice.provider)
        ? `voice provider "${voice.provider}" is not registered`
        : null;

    if (validationProblem || !voice) {
      throw new NarrationPreparationError(
        "validation",
        `Narration validation failed for slide ${slideIndex}, section ${sectionIndex + 1}, speaker "${speaker.label}": ${validationProblem}.`,
      );
    }

    return voice;
  }
}

/**
 * A one-off direction extends the speaker's character rather than replacing it,
 * so the preset leads and the inline prompt follows.
 */
function combineSpeakerPrompts(preset?: string, inline?: string): string | undefined {
  return [toSpeakerPrompt(preset), toSpeakerPrompt(inline)].filter(Boolean).join("\n") || undefined;
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

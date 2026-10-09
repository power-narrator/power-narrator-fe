import type { SpeakerMapping, SynthesizedSpeech, Voice } from "../tts/TtsProvider.js";
import type {
  NarratedSlideInput,
  NarrationPreparationProgress,
  PreviewNarrationRequest,
} from "../../shared/types/narration.js";
import type { SlideAudioEntry } from "../platform/types.js";
import { getEffectiveSpeaker } from "../../shared/narration/NarrationSections.js";
import {
  DEFAULT_SPEAKER_VALUE,
  toSynthesisSpeaker,
  type SynthesisSpeaker,
} from "../../shared/narration/speaker.js";
import { toSpeakerPrompt } from "../../shared/narration/prompt.js";
import { slideNumberOf, type SlideIndex } from "../../shared/slides/slideCoordinates.js";

/**
 * How a failure names a narration position to the author: the slide by its
 * 1-based number, the section by its 1-based position within that slide.
 */
const narrationPosition = (slideIndex: SlideIndex, sectionIndex: number): string =>
  `slide ${slideNumberOf(slideIndex)}, section ${sectionIndex + 1}`;

export type SpeakerMappingSource = {
  getSpeakerMappings(): Record<string, SpeakerMapping> | Promise<Record<string, SpeakerMapping>>;
};

export type NarrationSynthesizer = {
  supportsProvider(providerId: string): boolean;
  generateSpeech(text: string, voice: Voice, prompt?: string): Promise<SynthesizedSpeech>;
};

type PreparedNarrationSection = {
  slideIndex: SlideIndex;
  sectionIndex: number;
  synthesisSpeaker: SynthesisSpeaker;
  text: string;
  voice: Voice;
  prompt?: string;
};

type SynthesizedNarrationSection<Section extends PreparedNarrationSection> = Section & {
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
        `Narration validation failed for ${narrationPosition(request.slideIndex, request.sectionIndex)}: text is empty.`,
      );
    }

    const mappings = await this.mappingSource.getSpeakerMappings();
    const { sections } = request;
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
    slides: readonly NarratedSlideInput[],
    onProgress?: (progress: NarrationPreparationProgress) => void,
  ): Promise<SlideAudioEntry[]> {
    const mappings = await this.mappingSource.getSpeakerMappings();
    const prepared = slides.flatMap((slide) =>
      // Narration positions follow the submitted section order; mappings resolve
      // voices and prompts here, never which bracketed lines are speaker tags.
      slide.sections.flatMap((section, sectionIndex) => {
        const text = section.text.trim();
        if (!text) {
          return [];
        }

        const speaker = getEffectiveSpeaker(slide.sections, sectionIndex);

        return [
          {
            ...this.planSection(
              mappings,
              slide.slideIndex,
              sectionIndex,
              text,
              speaker,
              section.prompt,
            ),
            playAcrossSlides: section.playAcrossSlides,
          },
        ];
      }),
    );

    const synthesized = await this.synthesizeSections(prepared, onProgress);

    return synthesized.map(({ slideIndex, sectionIndex, speech, playAcrossSlides }) => ({
      slideIndex,
      sectionIndex,
      audioData: new Uint8Array(speech.audio),
      playAcrossSlides,
    }));
  }

  private planSection(
    mappings: Record<string, SpeakerMapping>,
    slideIndex: SlideIndex,
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

  private synthesizeSections<Section extends PreparedNarrationSection>(
    sections: Section[],
    onProgress?: (progress: NarrationPreparationProgress) => void,
  ): Promise<SynthesizedNarrationSection<Section>[]> {
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
            `Narration synthesis failed for ${narrationPosition(section.slideIndex, section.sectionIndex)}, speaker "${section.synthesisSpeaker.label}": ${message}.`,
          );
        }
      }),
    );
  }

  private resolveVoice(
    mapping: SpeakerMapping | undefined,
    speaker: SynthesisSpeaker,
    slideIndex: SlideIndex,
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
        `Narration validation failed for ${narrationPosition(slideIndex, sectionIndex)}, speaker "${speaker.label}": ${validationProblem}.`,
      );
    }

    return voice;
  }
}

const PROMPT_PRECEDENCE_INSTRUCTION =
  "Follow all of the instructions below. Where a later instruction conflicts with an earlier one, follow the later instruction.";

/**
 * A one-off direction extends the speaker's character but wins wherever the two
 * disagree, so the preset leads and the inline prompt follows.
 */
function combineSpeakerPrompts(preset?: string, inline?: string): string | undefined {
  const prompts = [toSpeakerPrompt(preset), toSpeakerPrompt(inline)].filter(Boolean);
  if (prompts.length < 2) {
    return prompts[0];
  }

  return [PROMPT_PRECEDENCE_INSTRUCTION, ...prompts].join("\n");
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

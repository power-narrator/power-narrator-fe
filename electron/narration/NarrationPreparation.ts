import type { Voice } from "../tts/TtsProvider.js";
import type { PreviewNarrationRequest } from "../../shared/types/narration.js";

export interface SpeakerMappingSource {
  getSpeakerMappings(): Record<string, Voice> | Promise<Record<string, Voice>>;
}

export interface NarrationSynthesizer {
  supportsProvider(providerId: string): boolean;
  generateSpeech(text: string, voice: Voice): Promise<Uint8Array | Buffer | null>;
}

const DEFAULT_SPEAKER_KEY = "_default_";
const SECTION_DIVIDER = /^[ \t]*-{3,}[ \t]*$/m;
const SPEAKER_TAG = /^(?:[ \t]*\n)*[ \t]*\[([^\]\n]*)\][ \t]*(?:\n|$)/;

function parseSectionSpeakers(notes: string): string[] {
  return notes
    .replace(/\r\n|[\r\u2028\u2029]/g, "\n")
    .split(SECTION_DIVIDER)
    .map((section) => section.match(SPEAKER_TAG)?.[1]?.trim() ?? "");
}

function effectiveSpeaker(speakers: string[], sectionIndex: number): string {
  for (let index = sectionIndex; index >= 0; index -= 1) {
    const speaker = speakers[index];
    if (speaker) {
      return speaker;
    }
  }

  return DEFAULT_SPEAKER_KEY;
}

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

  async preparePreview(request: PreviewNarrationRequest): Promise<Uint8Array | Buffer | null> {
    const text = request.text.trim();
    if (!text) {
      return null;
    }

    const speakers = parseSectionSpeakers(request.notes);
    const speaker =
      request.previewSpeaker !== undefined
        ? request.previewSpeaker || DEFAULT_SPEAKER_KEY
        : effectiveSpeaker(speakers, request.sectionIndex);
    const mappings = await this.mappingSource.getSpeakerMappings();
    const voice = mappings[speaker];
    const validationProblem =
      voiceValidationProblem(voice) ||
      (voice && !this.synthesizer.supportsProvider(String(voice.provider))
        ? `voice provider "${String(voice.provider)}" is not registered`
        : null);

    if (validationProblem || !voice) {
      const label = speaker === DEFAULT_SPEAKER_KEY ? "Default" : speaker;
      throw new Error(
        `Narration validation failed for slide ${request.slideIndex}, section ${request.sectionIndex + 1}, speaker "${label}": ${validationProblem}.`,
      );
    }

    return this.synthesizer.generateSpeech(text, voice);
  }
}

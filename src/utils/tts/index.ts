import type { Voice } from "../../../shared/types/tts";
import type { PreviewNarrationRequest } from "../../../shared/types/narration";

export const getPreviewAudioBuffer = async (
  request: PreviewNarrationRequest,
): Promise<ArrayBuffer | null> => {
  const result = await window.electronAPI.prepareNarrationPreview(request);
  return result ? Uint8Array.from(result).buffer : null;
};

function getCacheKey(text: string, voiceOption?: Voice): string {
  if (!voiceOption) {
    return `${text}_default`;
  }

  return `${text}_${voiceOption.provider}_${voiceOption.name}`;
}

/**
 * Generates an audio blob URL for the given text and voice configuration.
 * Extensively caches requests to prevent redundant API calls for identical phrases.
 *
 * @param text - The text to be synthesized into speech.
 * @param voiceOption - The voice indicating the desired speaker characteristics.
 * @returns A promise resolving to a local blob URL of the audio file.
 */
export const generateAudio = async (text: string, voiceOption?: Voice): Promise<string> => {
  const key = getCacheKey(text, voiceOption);

  if (generateAudio.cache.has(key)) {
    return generateAudio.cache.get(key)!;
  }

  try {
    const buffer = await getAudioBuffer(text, voiceOption);
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    generateAudio.cache.set(key, url);
    return url;
  } catch (error) {
    console.error("Error generating audio:", error);
    throw error;
  }
};

/**
 * Generates one audio file for the complete section text.
 *
 * @param text - The full section text to synthesize.
 * @param voiceOption - The voice selected for the section.
 * @returns A promise resolving to the generated audio bytes.
 */
export const getAudioBuffer = async (text: string, voiceOption?: Voice): Promise<ArrayBuffer> => {
  const result = await window.electronAPI.generateSpeech({ text, voiceOption });
  return Uint8Array.from(result).buffer;
};

/**
 * In-memory cache mapping unique text/voice combinations to standard base blob URLs.
 */
generateAudio.cache = new Map<string, string>();

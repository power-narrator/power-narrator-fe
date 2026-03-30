import type { VoiceOption } from './index';

/**
 * Represents a parsed audio segment containing text and its assigned voice characteristics.
 */
export interface AudioSegment {
    voice: VoiceOption | null;
    text: string;
}

/**
 * Parses raw input text containing custom speaker tags into an array of discrete audio segments.
 * Recognized tags include `[alias]` mapping to preset voices and `[provider:name]` 
 * for direct voice assignments. It also strips out document separation markers before parsing.
 * 
 * @param text - The raw text containing optional speaker tags.
 * @param mappings - A record mapping predefined speaker aliases to internal VoiceOptions.
 * @param voiceOption - The default VoiceOption to use if no custom speaker tag is found.
 * @returns An array of AudioSegments separated by their designated speaker.
 * @throws Will throw an Error if an unmapped or improperly configured alias is encountered.
 */
export const parseTtsSegments = (
    text: string,
    mappings: Record<string, VoiceOption>,
    voiceOption?: VoiceOption
): AudioSegment[] => {
    const tagRegex = /\[([^\]]+)\]/g;

    const textWithoutSeparators = text.replace(/^\s*---\s*$/gm, '\n');

    const parts = textWithoutSeparators.split(tagRegex);

    let currentVoice = voiceOption || mappings['_default_'] || null;

    const segments: AudioSegment[] = [];

    if (parts.length === 1) {
        segments.push({ voice: currentVoice, text: parts[0] });
    } else {
        let i = 0;
        while (i < parts.length) {
            const textSegment = parts[i];

            if (textSegment.trim().length > 0) {
                segments.push({ voice: currentVoice, text: textSegment });
            }

            if (i + 1 < parts.length) {
                const tag = parts[i + 1].trim();
                
                if (mappings[tag]) {
                    currentVoice = mappings[tag];
                    if (!currentVoice || !currentVoice.name) {
                        throw new Error(`Speaker alias '[${tag}]' exists but has no voice assigned. Please configure it in Settings.`);
                    }
                } else if (tag.includes(':')) {
                    const tagParts = tag.split(':');
                    const provider = tagParts[0];
                    const name = tagParts[1];
                    currentVoice = { name, provider, languageCodes: ['en-US'], ssmlGender: 'NEUTRAL' } as VoiceOption;
                } else {
                    throw new Error(`Speaker alias '[${tag}]' is not configured. Please add it in Settings.`);
                }
            }

            i += 2;
        }
    }

    return segments;
};

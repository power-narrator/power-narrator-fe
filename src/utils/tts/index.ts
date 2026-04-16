import { concatUint8Arrays } from './audioUtils';
import { parseTtsSegments } from './ttsParse';

/**
 * Configuration options specifying the generated speech voice characteristics.
 */
export interface VoiceOption {
    name: string;
    languageCodes: string[];
    ssmlGender: string;
    provider?: string;
}

/**
 * Generates an audio blob URL for the given text and voice configuration.
 * Extensively caches requests to prevent redundant API calls for identical phrases.
 * 
 * @param text - The text to be synthesized into speech.
 * @param voiceOption - The VoiceOption indicating the desired speaker characteristics.
 * @returns A promise resolving to a local blob URL of the audio file.
 */
export const generateAudio = async (text: string, voiceOption?: VoiceOption): Promise<string> => {
    let mappingsStr = "";
    if (window.electronAPI && window.electronAPI.getSpeakerMappings) {
        mappingsStr = JSON.stringify(await window.electronAPI.getSpeakerMappings());
    }

    const key = text + (voiceOption ? `_${voiceOption.name}` : '_default') + '_' + mappingsStr;

    if (generateAudio.cache.has(key)) {
        return generateAudio.cache.get(key)!;
    }

    try {
        const buffer = await getAudioBuffer(text, voiceOption);
        const view = new Uint8Array(buffer);
        const isWav = view.length >= 4 && view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46;
        const blob = new Blob([buffer as any], { type: isWav ? 'audio/wav' : 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        generateAudio.cache.set(key, url);
        return url;
    } catch (error) {
        console.error('Error generating audio:', error);
        throw error;
    }
};

/**
 * Parses raw text into segmented parts based on speaker tags, invokes the backend 
 * TTS service for each chunk, and concatenates the results into a single buffer.
 * 
 * @param text - The full text to synthesize, possibly containing embedded speaker tags.
 * @param voiceOption - The default VoiceOption used if a segment lacks an explicit tag.
 * @returns A promise resolving to an ArrayBuffer of the fully concatenated audio.
 */
export const getAudioBuffer = async (text: string, voiceOption?: VoiceOption): Promise<ArrayBuffer> => {
    let mappings: Record<string, VoiceOption> = {};
    if (window.electronAPI && window.electronAPI.getSpeakerMappings) {
        mappings = await window.electronAPI.getSpeakerMappings();
    }

    const segments = parseTtsSegments(text, mappings, voiceOption);

    const buffers: Uint8Array[] = [];

    for (const seg of segments) {
        if (!seg.text.trim()) continue;

        const chunkKey = seg.text + (seg.voice ? `_${seg.voice.name}` : '_default');

        let chunkData: Uint8Array | null = null;

        if (generateAudio.cache.has(chunkKey)) {
            try {
                const res = await fetch(generateAudio.cache.get(chunkKey)!);
                if (res.ok) {
                    const ab = await res.arrayBuffer();
                    chunkData = new Uint8Array(ab);
                }
            } catch (e) {
                // Ignore fetch cache failure and regenerate
            }
        }

        if (!chunkData) {
            const result: Uint8Array = await window.electronAPI.generateSpeech({
                text: seg.text,
                voiceOption: seg.voice
            });
            chunkData = result;

            const isWavChunk = chunkData.length >= 4 && chunkData[0] === 0x52 && chunkData[1] === 0x49 && chunkData[2] === 0x46 && chunkData[3] === 0x46;
            const blob = new Blob([chunkData as any], { type: isWavChunk ? 'audio/wav' : 'audio/mp3' });
            generateAudio.cache.set(chunkKey, URL.createObjectURL(blob));
        }

        buffers.push(chunkData);
    }

    const finalBuffer = concatUint8Arrays(buffers);

    return finalBuffer.buffer as ArrayBuffer;
};

/**
 * In-memory cache mapping unique text/voice combinations to standard base blob URLs.
 */
generateAudio.cache = new Map<string, string>();

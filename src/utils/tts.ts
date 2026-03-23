const { ipcRenderer } = (window as any).require('electron');
export interface VoiceOption {
    name: string;
    languageCodes: string[];
    ssmlGender: string;
    provider?: string;
}

export const generateAudio = async (text: string, voiceOption?: VoiceOption): Promise<string> => {
    // Generate an aggressive caching key that incorporates the raw text + voice option
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
        const isWav = view.length >= 4 && view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46; // RIFF
        const blob = new Blob([buffer as any], { type: isWav ? 'audio/wav' : 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        generateAudio.cache.set(key, url);
        return url;
    } catch (error) {
        console.error('Error generating audio:', error);
        throw error;
    }
};

// Helper to concatenate Uint8Arrays (handles both MP3 and WAV)
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    if (arrays.length === 0) return new Uint8Array(0);

    // Check if it's WAV (starts with 'RIFF')
    const isWav = arrays[0].length >= 44 &&
        arrays[0][0] === 0x52 && // R
        arrays[0][1] === 0x49 && // I
        arrays[0][2] === 0x46 && // F
        arrays[0][3] === 0x46;   // F

    if (isWav) {
        let totalDataLength = 0;
        const mapped = arrays.map(arr => {
            // Find 'data' chunk
            let offset = 12; // Start after RIFF ... WAVE 
            let dataOffset = 44;
            let dataLen = arr.length - 44;
            while (offset < arr.length - 8) {
                if (arr[offset] === 0x64 && arr[offset + 1] === 0x61 && arr[offset + 2] === 0x74 && arr[offset + 3] === 0x61) {
                    // 'data' found
                    dataLen = arr[offset + 4] | (arr[offset + 5] << 8) | (arr[offset + 6] << 16) | (arr[offset + 7] << 24);
                    dataOffset = offset + 8;
                    break;
                }
                const chunkLen = arr[offset + 4] | (arr[offset + 5] << 8) | (arr[offset + 6] << 16) | (arr[offset + 7] << 24);
                offset += 8 + chunkLen;
            }
            return { headerLen: dataOffset, dataLen: dataLen, arr };
        });

        totalDataLength = mapped.reduce((sum, item) => sum + item.dataLen, 0);

        const firstHeaderLen = mapped[0].headerLen;
        const out = new Uint8Array(firstHeaderLen + totalDataLength);

        // Copy first file's header
        out.set(mapped[0].arr.slice(0, firstHeaderLen), 0);

        // Update RIFF chunk size (total file size - 8)
        const riffSize = firstHeaderLen + totalDataLength - 8;
        out[4] = (riffSize & 0xff);
        out[5] = ((riffSize >> 8) & 0xff);
        out[6] = ((riffSize >> 16) & 0xff);
        out[7] = ((riffSize >> 24) & 0xff);

        // Update data chunk size
        const dataChunkSizeOffset = firstHeaderLen - 4;
        out[dataChunkSizeOffset] = (totalDataLength & 0xff);
        out[dataChunkSizeOffset + 1] = ((totalDataLength >> 8) & 0xff);
        out[dataChunkSizeOffset + 2] = ((totalDataLength >> 16) & 0xff);
        out[dataChunkSizeOffset + 3] = ((totalDataLength >> 24) & 0xff);

        // Copy all data
        let currentOffset = firstHeaderLen;
        for (const m of mapped) {
            out.set(m.arr.slice(m.headerLen, m.headerLen + m.dataLen), currentOffset);
            currentOffset += m.dataLen;
        }

        return out;
    }

    // Default simple payload concatenation for MP3
    const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }
    return result;
}

export const getAudioBuffer = async (text: string, voiceOption?: VoiceOption): Promise<ArrayBuffer> => {
    // 1. Fetch current mappings from backend
    let mappings: Record<string, VoiceOption> = {};
    if (window.electronAPI && window.electronAPI.getSpeakerMappings) {
        mappings = await window.electronAPI.getSpeakerMappings();
    }

    // 2. Parse text for tags. Regex looks for [tag] literal
    const tagRegex = /\[([^\]]+)\]/g;

    // Remove `---` separators that optionally have blank lines around them so TTS won't read them
    const textWithoutSeparators = text.replace(/^\s*---\s*$/gm, '\n');

    // We split the string by the regex. 
    // split() with capturing group returns an array like:
    // ["normal text", "speaker 1", "  more text", "speaker 2", " final"]
    // Odd indices are the captured tags. Even indices are text outside tags.
    const parts = textWithoutSeparators.split(tagRegex);

    // Default starting active voice
    // Try provided voiceOption -> mapped default -> null
    let currentVoice = voiceOption || mappings['_default_'] || null;

    interface AudioSegment {
        voice: VoiceOption | null;
        text: string;
    }

    const segments: AudioSegment[] = [];

    if (parts.length === 1) {
        // No tags found
        segments.push({ voice: currentVoice, text: parts[0] });
    } else {
        // We have tags
        let i = 0;
        while (i < parts.length) {
            // Even index = text segment
            const textSegment = parts[i];

            if (textSegment.trim().length > 0) {
                segments.push({ voice: currentVoice, text: textSegment });
            }

            // Odd index = tag content immediately following the text segment
            if (i + 1 < parts.length) {
                const tag = parts[i + 1].trim();
                // Check if tag exists in mappings
                if (mappings[tag]) {
                    currentVoice = mappings[tag];
                    // Also check if the mapping itself is empty (user added alias but didn't pick a voice)
                    if (!currentVoice || !currentVoice.name) {
                        throw new Error(`Speaker alias '[${tag}]' exists but has no voice assigned. Please configure it in Settings.`);
                    }
                } else if (tag.includes(':')) {
                    // Direct voice tag inserted via the editor (e.g., [gcp:en-US-Journey-F])
                    const parts = tag.split(':');
                    const provider = parts[0];
                    const name = parts[1];
                    currentVoice = { name, provider, languageCodes: ['en-US'], ssmlGender: 'NEUTRAL' } as VoiceOption;
                } else {
                    // Legacy or missing mapping? Throw an error instead of silently falling back.
                    throw new Error(`Speaker alias '[${tag}]' is not configured. Please add it in Settings.`);
                }
            }

            i += 2;
        }
    }

    // 3. Generate audio for each segment sequentially
    const buffers: Uint8Array[] = [];

    for (const seg of segments) {
        if (!seg.text.trim()) continue;

        // Key for this specific chunk
        const chunkKey = seg.text + (seg.voice ? `_${seg.voice.name}` : '_default');

        // Attempt local cache fetch for this chunk (if we have a URL, we can fetch it)
        // This is a naive cache for the chunk
        let chunkData: Uint8Array | null = null;

        if (generateAudio.cache.has(chunkKey)) {
            try {
                const res = await fetch(generateAudio.cache.get(chunkKey)!);
                if (res.ok) {
                    const ab = await res.arrayBuffer();
                    chunkData = new Uint8Array(ab);
                }
            } catch (e) {
                // cache read failed, proceed to generate
            }
        }

        if (!chunkData) {
            const result: Uint8Array = await ipcRenderer.invoke('generate-speech', {
                text: seg.text,
                voiceOption: seg.voice
            });
            chunkData = result;

            // optionally cache
            const isWavChunk = chunkData.length >= 4 && chunkData[0] === 0x52 && chunkData[1] === 0x49 && chunkData[2] === 0x46 && chunkData[3] === 0x46; // RIFF
            const blob = new Blob([chunkData as any], { type: isWavChunk ? 'audio/wav' : 'audio/mp3' });
            generateAudio.cache.set(chunkKey, URL.createObjectURL(blob));
        }

        buffers.push(chunkData);
    }

    // 4. Concatenate MP3 frames
    const finalBuffer = concatUint8Arrays(buffers);

    return finalBuffer.buffer as ArrayBuffer;
};

// Add a cache property to the function
generateAudio.cache = new Map<string, string>();

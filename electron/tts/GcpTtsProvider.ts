import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { TtsProvider, VoiceOption } from './TtsProvider.js';
import { SsmlUtil } from './SsmlUtil.js';

export class GcpTtsProvider implements TtsProvider {
    constructor(private keyPathProvider: () => string | undefined) {}

    async getVoices(): Promise<VoiceOption[]> {
        const keyPath = this.keyPathProvider();
        if (!keyPath) {
            console.warn("GOOGLE_APPLICATION_CREDENTIALS is not set; skipping GCP voices.");
            return [];
        }

        const options: any = { keyFilename: keyPath };
        const client = new TextToSpeechClient(options);
        const voices: VoiceOption[] = [];

        try {
            const [gbResult] = await client.listVoices({ languageCode: 'en-GB' });
            if (gbResult.voices) {
                const gbGcpVoices = gbResult.voices
                    .filter(v => v.name && v.name.includes('Chirp3-HD'))
                    .map(v => ({ ...v, provider: 'gcp' })) as VoiceOption[];
                voices.push(...gbGcpVoices);
            }

            const [usResult] = await client.listVoices({ languageCode: 'en-US' });
            if (usResult.voices) {
                const usGcpVoices = usResult.voices
                    .filter(v => v.name && v.name.includes('Chirp3-HD'))
                    .map(v => ({ ...v, provider: 'gcp' })) as VoiceOption[];
                voices.push(...usGcpVoices);
            }
        } catch (error) {
            console.error("Failed to list GCP voices:", error);
        }

        return voices;
    }

    async generateSpeech(text: string, voiceOption: VoiceOption | null): Promise<Uint8Array | null> {
        const keyPath = this.keyPathProvider();
        if (!keyPath) {
            throw new Error("GCP TTS requested but GOOGLE_APPLICATION_CREDENTIALS is not set");
        }

        const options: any = { keyFilename: keyPath };
        const client = new TextToSpeechClient(options);

        const formatted = SsmlUtil.formatForGcp(text);
        const input: any = formatted.isSsml ? { ssml: formatted.content } : { text: formatted.content };

        const request: any = {
            input: input,
            voice: voiceOption 
                ? { languageCode: voiceOption.languageCodes[0], name: voiceOption.name } 
                : { languageCode: 'en-US', name: 'en-US-Journey-F' },
            audioConfig: { audioEncoding: 'MP3' },
        };

        const [response] = await client.synthesizeSpeech(request);
        return response.audioContent ? (response.audioContent as Uint8Array) : null;
    }
}

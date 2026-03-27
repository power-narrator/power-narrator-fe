import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { TtsProvider, VoiceOption } from './TtsProvider';
import { GcpTtsProvider } from './GcpTtsProvider';
import { LocalTtsProvider } from './LocalTtsProvider';

export class TtsManager {
    private providers: Record<string, TtsProvider> = {};

    constructor(private defaultProviderName: string, gcpKeyPathProvider: () => string | undefined) {
        this.providers['gcp'] = new GcpTtsProvider(gcpKeyPathProvider);
        this.providers['local'] = new LocalTtsProvider();
    }

    async getVoices(): Promise<VoiceOption[]> {
        const allVoices: VoiceOption[] = [];
        
        // Fetch from all registered providers
        for (const provider of Object.values(this.providers)) {
            try {
                const voices = await provider.getVoices();
                allVoices.push(...voices);
            } catch (error) {
                console.error("Failed fetching voices from provider", error);
            }
        }

        return allVoices;
    }

    async generateSpeech(text: string, voiceOption: VoiceOption | null, fallbackProviderName?: string): Promise<Uint8Array | null> {
        const providerName = (voiceOption?.provider) || fallbackProviderName || this.defaultProviderName;
        const provider = this.providers[providerName];

        if (!provider) {
            throw new Error(`TTS Provider '${providerName}' is not registered.`);
        }

        const cacheDir = path.join(app.getPath('userData'), 'tts_cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const voiceStr = voiceOption ? JSON.stringify(voiceOption) : 'default';
        const hash = crypto.createHash('sha256').update(text + voiceStr + providerName).digest('hex');
        const cachePath = path.join(cacheDir, `${hash}.mp3`);

        if (fs.existsSync(cachePath)) {
            console.log(`Serving TTS from persistent cache: ${hash}`);
            const buffer = fs.readFileSync(cachePath);
            return new Uint8Array(buffer);
        }

        try {
            const audioData = await provider.generateSpeech(text, voiceOption);
            
            if (audioData) {
                try {
                    fs.writeFileSync(cachePath, Buffer.from(audioData));
                } catch (e) {
                    console.error("Failed to write TTS cache:", e);
                }
            }
            
            return audioData;
        } catch (error: any) {
            console.error(`TTS generation failed via ${providerName}:`, error);
            throw new Error(error.message || "Unknown TTS error");
        }
    }
}

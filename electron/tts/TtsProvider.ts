export interface VoiceOption {
    name: string;
    ssmlGender: string;
    languageCodes: string[];
    provider: string; 
    [key: string]: any;
}

export interface TtsProvider {
    getVoices(): Promise<VoiceOption[]>;
    generateSpeech(text: string, voiceOption: VoiceOption | null): Promise<Uint8Array | Buffer | null>;
}

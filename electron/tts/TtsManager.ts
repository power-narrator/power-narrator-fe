import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { app } from "electron";
import type { TtsProviderId, TtsProviderRegistry, Voice } from "./TtsProvider.js";

export class TtsManager {
  private readonly providers: TtsProviderRegistry;
  readonly defaultProviderId: TtsProviderId;

  constructor(providers: TtsProviderRegistry, configuredDefaultProvider: string) {
    const defaultProviderId = Array.from(providers.keys()).find(
      (providerId) => providerId === configuredDefaultProvider,
    );
    if (!defaultProviderId) {
      throw new Error(`TTS Provider '${configuredDefaultProvider}' is not registered.`);
    }

    this.providers = new Map(providers);
    this.defaultProviderId = defaultProviderId;
  }

  async getVoices(): Promise<Voice[]> {
    const voiceLists = await Promise.all(
      Array.from(this.providers, async ([providerId, provider]) => {
        try {
          return await provider.getVoices();
        } catch (error) {
          console.error(`Failed fetching voices from provider '${providerId}':`, error);
          return [];
        }
      }),
    );

    return voiceLists.flat();
  }

  async generateSpeech(text: string, voiceOption?: Voice): Promise<Uint8Array | null> {
    const providerId = voiceOption === undefined ? this.defaultProviderId : voiceOption.provider;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`TTS Provider '${providerId}' is not registered.`);
    }

    const cacheDir = path.join(app.getPath("userData"), "tts_cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const voiceStr = voiceOption ? JSON.stringify(voiceOption) : "default";
    const hash = crypto
      .createHash("sha256")
      .update(text + voiceStr + providerId)
      .digest("hex");
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
    } catch (error: unknown) {
      console.error(`TTS generation failed via ${providerId}:`, error);
      throw new Error(error instanceof Error ? error.message : "Unknown TTS error");
    }
  }
}

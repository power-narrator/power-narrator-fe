import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { app } from "electron";
import { APP_NAME } from "../platform/helpers.js";
import type {
  SynthesizedSpeech,
  TtsProviderId,
  TtsProviderRegistry,
  Voice,
} from "./TtsProvider.js";

export function getNarrationCacheDirectory(
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const cacheRoot =
      environment.LOCALAPPDATA && path.win32.isAbsolute(environment.LOCALAPPDATA)
        ? environment.LOCALAPPDATA
        : path.win32.join(homeDirectory, "AppData", "Local");
    return path.win32.join(cacheRoot, APP_NAME, "Cache", "narration");
  }

  const cacheRoot =
    platform === "darwin"
      ? path.join(homeDirectory, "Library", "Caches")
      : environment.XDG_CACHE_HOME && path.isAbsolute(environment.XDG_CACHE_HOME)
        ? environment.XDG_CACHE_HOME
        : path.join(homeDirectory, ".cache");

  return path.join(cacheRoot, APP_NAME, "narration");
}

function deterministicJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(deterministicJson).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${deterministicJson(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export class TtsManager {
  private readonly providers: TtsProviderRegistry;
  private readonly cacheDirectory: string;
  private readonly pending = new Map<string, Promise<SynthesizedSpeech>>();
  readonly defaultProviderId: TtsProviderId;

  constructor(
    providers: TtsProviderRegistry,
    configuredDefaultProvider: string,
    cacheLocations: { cacheDirectory?: string } = {},
  ) {
    const defaultProviderId = Array.from(providers.keys()).find(
      (providerId) => providerId === configuredDefaultProvider,
    );
    if (!defaultProviderId) {
      throw new Error(`TTS Provider '${configuredDefaultProvider}' is not registered.`);
    }

    this.providers = new Map(providers);
    this.cacheDirectory =
      cacheLocations.cacheDirectory ?? getNarrationCacheDirectory(app.getPath("home"));
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

  supportsProvider(providerId: string): providerId is TtsProviderId {
    return this.providers.has(providerId as TtsProviderId);
  }

  async generateSpeech(text: string, voice: Voice): Promise<SynthesizedSpeech> {
    const providerId = voice.provider;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`TTS Provider '${providerId}' is not registered.`);
    }

    const cacheDir = this.cacheDirectory;
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const preparedRequest = provider.prepareSpeech(text, voice);
    const hash = crypto
      .createHash("sha256")
      .update(
        deterministicJson({
          provider: providerId,
          request: preparedRequest.cacheIdentity,
        }),
      )
      .digest("hex");
    const mediaType = preparedRequest.encoding.mediaType;
    const cachePath = path.join(cacheDir, `${hash}.${preparedRequest.encoding.fileExtension}`);

    if (fs.existsSync(cachePath)) {
      console.log(`Serving TTS from persistent cache: ${hash}`);
      const buffer = fs.readFileSync(cachePath);
      return { audio: new Uint8Array(buffer), mediaType };
    }

    const existingRequest = this.pending.get(hash);
    if (existingRequest) {
      return existingRequest;
    }

    const pendingRequest = Promise.resolve()
      .then(() => preparedRequest.synthesize())
      .then((audioData) => {
        this.writeCacheEntry(cachePath, Buffer.from(audioData));
        return { audio: new Uint8Array(audioData), mediaType };
      })
      .catch((error: unknown) => {
        console.error(`TTS generation failed via ${providerId}:`, error);
        throw new Error(error instanceof Error ? error.message : "Unknown TTS error");
      })
      .finally(() => this.pending.delete(hash));
    this.pending.set(hash, pendingRequest);
    return pendingRequest;
  }

  /**
   * Publishes a cache entry by renaming a fully written temporary file, so an
   * interrupted write never leaves a truncated entry to be served later.
   */
  private writeCacheEntry(cachePath: string, audio: Buffer): void {
    const temporaryPath = `${cachePath}.${crypto.randomUUID()}.part`;
    try {
      fs.writeFileSync(temporaryPath, audio);
      fs.renameSync(temporaryPath, cachePath);
    } catch (error) {
      console.error("Failed to write TTS cache:", error);
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

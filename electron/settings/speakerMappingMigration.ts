import type { SpeakerMapping, TtsProviderId, Voice } from "../tts/TtsProvider.js";
import { decomposeGcpVoiceName } from "../tts/GcpTtsProvider.js";

interface LegacySpeakerMapping {
  name?: unknown;
  provider?: unknown;
  prompt?: unknown;
}

const decomposers: Record<TtsProviderId, (name: string) => Omit<Voice, "provider"> | null> = {
  gcp: decomposeGcpVoiceName,
};

function convertRecord(record: unknown): SpeakerMapping {
  if (record === null || typeof record !== "object") {
    return {};
  }

  const legacy = record as LegacySpeakerMapping;
  if (typeof legacy.name !== "string" || typeof legacy.provider !== "string") {
    return record;
  }

  const composition = decomposers[legacy.provider]?.(legacy.name);
  const prompt = typeof legacy.prompt === "string" ? { prompt: legacy.prompt } : {};

  return composition ? { voice: { provider: legacy.provider, ...composition }, ...prompt } : prompt;
}

export function migrateSpeakerMappings(mappings: unknown): Record<string, SpeakerMapping> {
  if (mappings === null || typeof mappings !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(mappings as Record<string, unknown>).map(([alias, record]) => [
      alias,
      convertRecord(record),
    ]),
  );
}

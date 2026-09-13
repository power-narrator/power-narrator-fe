import type { SpeakerMapping, TtsProviderId, Voice } from "../tts/TtsProvider.js";
import { decomposeGcpVoiceName } from "../tts/GcpTtsProvider.js";

/**
 * The mapping value as it was stored before speaker mappings gained a prompt:
 * one record per speaker holding the provider's composed voice identifier in
 * `name`. Delete this module once no installation can still be on that version.
 */
interface LegacySpeakerMapping {
  name?: unknown;
  provider?: unknown;
  prompt?: unknown;
}

/**
 * A legacy identifier is decomposed by the provider that composed it, using the
 * same grammar it applies to its own catalogue, so no provider carries code
 * that exists only to read the old format.
 */
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

  // Nothing about an undecomposable voice survives, since the voice key was
  // only recoverable by decomposition.
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

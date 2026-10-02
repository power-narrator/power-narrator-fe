import type { Result } from "./result.js";
import type { SpeakerMapping, VoiceOption } from "./tts.js";

export type Settings = {
  gcpKeyPath: string | null;
  speakerMappings: Record<string, SpeakerMapping>;
  xmlCliEnabled: boolean;
};

/** A `null` path means the picker was dismissed without choosing a file. */
export type SelectGcpKeyResult = Result<{ path: string | null }>;

/** `failure` explains why the staged key's voices are missing from `voices`. */
export type VoicePreview = {
  voices: VoiceOption[];
  failure: string | null;
};

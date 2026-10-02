import type { Result } from "./result.js";
import type { SpeakerMapping } from "./tts.js";

export type Settings = {
  gcpKeyPath: string | null;
  speakerMappings: Record<string, SpeakerMapping>;
  xmlCliEnabled: boolean;
};

/** A `null` path means the picker was dismissed without choosing a file. */
export type SelectGcpKeyResult = Result<{ path: string | null }>;

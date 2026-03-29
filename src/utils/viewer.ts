import {
  DEFAULT_SPEAKER_KEY,
  DEFAULT_SPEAKER_LABEL,
  DEFAULT_SPEAKER_VALUE,
} from "../constants/speaker";
import type { Voice } from "../types/voice";

export function getSpeakerOptions(mappings: Record<string, Voice>) {
  return [{ value: DEFAULT_SPEAKER_VALUE, label: DEFAULT_SPEAKER_LABEL }].concat(
    Object.keys(mappings)
      .filter((key) => key !== DEFAULT_SPEAKER_KEY)
      .map((key) => ({ value: key, label: key })),
  );
}

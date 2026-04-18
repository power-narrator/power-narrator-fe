import { DEFAULT_SPEAKER_VALUE } from "../constants/speaker";
import type { NoteSection } from "../types/notes";

export const parseNotes = (text: string): NoteSection[] => {
  if (!text) {
    return [{ speaker: "", text: "" }];
  }

  return text.split(/\r?\n---\r?\n/g).map((part) => {
    const match = part.match(/^\[([^\]]+)\]\n([\s\S]*)$/);

    if (match) {
      return { speaker: match[1], text: match[2] };
    }

    return { speaker: DEFAULT_SPEAKER_VALUE, text: part };
  });
};

export const getEffectiveSpeaker = (sections: NoteSection[], index: number): string => {
  const current = sections[index]?.speaker;
  if (current && current !== DEFAULT_SPEAKER_VALUE) {
    return current;
  }

  // Look backwards for the most recent specified speaker
  for (let i = index - 1; i >= 0; i--) {
    const prev = sections[i]?.speaker;
    if (prev && prev !== DEFAULT_SPEAKER_VALUE) {
      return prev;
    }
  }

  return DEFAULT_SPEAKER_VALUE;
};

export const formatNotes = (sections: NoteSection[]): string => {
  return sections
    .map((section) => {
      const speakerPart = section.speaker !== DEFAULT_SPEAKER_VALUE ? `[${section.speaker}]\n` : "";
      return `${speakerPart}${section.text}`;
    })
    .join("\n---\n");
};

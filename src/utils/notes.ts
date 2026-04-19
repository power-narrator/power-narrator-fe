import { DEFAULT_SPEAKER_VALUE } from "../constants/speaker";
import type { NoteSection } from "../types/notes";

const SECTION_DIVIDER_PATTERN = /^[ \t]*-{3,}[ \t]*$/;
const SPEAKER_TAG_PATTERN = /^[ \t]*\[([^\]]*)\][ \t]*$/;
const WHITESPACE_ONLY_PATTERN = /^[ \t]*$/;

export const normalizeNotes = (text: string): string => text.replace(/\r\n|\r/g, "\n");

function splitRawSections(text: string): string[] {
  const lines = text.split("\n");
  const sections = [""];

  for (const line of lines) {
    if (SECTION_DIVIDER_PATTERN.test(line)) {
      sections.push("");
      continue;
    }

    const current = sections[sections.length - 1];
    sections[sections.length - 1] = current ? `${current}\n${line}` : line;
  }

  return sections;
}

function parseSection(rawSection: string): NoteSection {
  const lines = rawSection.split("\n");
  let speakerLineIndex = 0;

  while (speakerLineIndex < lines.length && WHITESPACE_ONLY_PATTERN.test(lines[speakerLineIndex])) {
    speakerLineIndex += 1;
  }

  const speakerMatch =
    speakerLineIndex < lines.length ? lines[speakerLineIndex].match(SPEAKER_TAG_PATTERN) : null;

  if (!speakerMatch) {
    return {
      speaker: DEFAULT_SPEAKER_VALUE,
      text: rawSection,
    };
  }

  return {
    speaker: speakerMatch[1].trim() || DEFAULT_SPEAKER_VALUE,
    text: lines.slice(speakerLineIndex + 1).join("\n"),
  };
}

export const parseNotes = (text: string): NoteSection[] => {
  return splitRawSections(normalizeNotes(text)).map(parseSection);
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
      if (section.speaker !== DEFAULT_SPEAKER_VALUE) {
        return section.text ? `[${section.speaker}]\n${section.text}` : `[${section.speaker}]`;
      }

      return section.text;
    })
    .join("\n---\n");
};

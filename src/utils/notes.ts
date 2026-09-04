import { DEFAULT_SPEAKER_VALUE } from "../constants/speaker";
import type { NoteSection } from "../types/notes";

const DEFAULT_SECTION_SEPARATOR = "\n---\n";
const SECTION_DIVIDER_PATTERN = /^[ \t]*-{3,}[ \t]*(?:\n)?$/;
const SPEAKER_TAG_PATTERN = /^((?:[ \t]*\n)*[ \t]*)\[([^\]\n]*)\]([ \t]*)(?:\n|$)/;
const LEADING_WHITESPACE_PATTERN = /^[ \t]*/;
const TRAILING_WHITESPACE_PATTERN = /[ \t]*$/;

interface RawNoteSection {
  separatorBefore?: string;
  text: string;
}

export const normalizeNotes = (text: string): string => text.replace(/\r\n|\r/g, "\n");

function splitRawSections(text: string): RawNoteSection[] {
  const sections: RawNoteSection[] = [];
  let currentText = "";
  let separatorBefore: string | undefined;
  let lineStart = 0;

  while (lineStart < text.length) {
    const newlineIndex = text.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex + 1;
    const line = text.slice(lineStart, lineEnd);

    if (SECTION_DIVIDER_PATTERN.test(line)) {
      let separator = line;
      if (currentText.endsWith("\n")) {
        currentText = currentText.slice(0, -1);
        separator = `\n${separator}`;
      }

      sections.push({
        separatorBefore,
        text: currentText,
      });
      separatorBefore = separator;
      currentText = "";
    } else {
      currentText = `${currentText}${line}`;
    }

    lineStart = lineEnd;
  }

  sections.push({
    separatorBefore,
    text: currentText,
  });

  return sections;
}

function parseSection(rawSection: RawNoteSection): NoteSection {
  const speakerMatch = rawSection.text.match(SPEAKER_TAG_PATTERN);
  const format = rawSection.separatorBefore ? { separatorBefore: rawSection.separatorBefore } : {};

  if (!speakerMatch) {
    return {
      speaker: DEFAULT_SPEAKER_VALUE,
      text: rawSection.text,
      ...(Object.keys(format).length ? { format } : {}),
    };
  }

  const speakerText = speakerMatch[2] ?? "";
  const leadingSpeakerWhitespace = speakerText.match(LEADING_WHITESPACE_PATTERN)?.[0] || "";
  const trailingSpeakerWhitespace = speakerText.match(TRAILING_WHITESPACE_PATTERN)?.[0] || "";

  return {
    speaker: speakerText.trim() || DEFAULT_SPEAKER_VALUE,
    text: rawSection.text.slice(speakerMatch[0].length),
    format: {
      ...format,
      speakerPrefix: `${speakerMatch[1]}[${leadingSpeakerWhitespace}`,
      speakerSuffix: `${trailingSpeakerWhitespace}]${speakerMatch[3]}`,
    },
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
  return sections.reduce((notes, section, index) => {
    const separator = index > 0 ? section.format?.separatorBefore || DEFAULT_SECTION_SEPARATOR : "";

    if (section.speaker !== DEFAULT_SPEAKER_VALUE) {
      const speakerPrefix = section.format?.speakerPrefix || "[";
      const speakerSuffix = section.format?.speakerSuffix || "]";
      const speakerTag = `${speakerPrefix}${section.speaker}${speakerSuffix}`;
      const sectionText = section.text ? `${speakerTag}\n${section.text}` : speakerTag;

      return `${notes}${separator}${sectionText}`;
    }

    return `${notes}${separator}${section.text}`;
  }, "");
};

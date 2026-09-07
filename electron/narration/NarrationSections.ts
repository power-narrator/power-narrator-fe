const DEFAULT_SECTION_SEPARATOR = "\n---\n";
const SECTION_DIVIDER_PATTERN = /^[ \t]*-{3,}[ \t]*(?:\n)?$/;
const SPEAKER_TAG_PATTERN = /^((?:[ \t]*\n)*[ \t]*)\[([^\]\n]*)\]([ \t]*)(?:\n|$)/;
const LEADING_WHITESPACE_PATTERN = /^[ \t]*/;
const TRAILING_WHITESPACE_PATTERN = /[ \t]*$/;

export interface NarrationSection {
  speaker: string;
  text: string;
  format?: {
    separatorBefore?: string;
    speakerPrefix?: string;
    speakerSuffix?: string;
  };
}

interface RawNarrationSection {
  separatorBefore?: string;
  text: string;
}

export const normalizeNotes = (text: string): string =>
  text.replace(/\r\n|[\r\u2028\u2029]/g, "\n");

function splitRawSections(text: string): RawNarrationSection[] {
  const sections: RawNarrationSection[] = [];
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

      sections.push({ separatorBefore, text: currentText });
      separatorBefore = separator;
      currentText = "";
    } else {
      currentText = `${currentText}${line}`;
    }

    lineStart = lineEnd;
  }

  sections.push({ separatorBefore, text: currentText });
  return sections;
}

function parseSection(rawSection: RawNarrationSection): NarrationSection {
  const speakerMatch = rawSection.text.match(SPEAKER_TAG_PATTERN);
  const format = rawSection.separatorBefore ? { separatorBefore: rawSection.separatorBefore } : {};

  if (!speakerMatch) {
    return {
      speaker: "",
      text: rawSection.text,
      ...(Object.keys(format).length ? { format } : {}),
    };
  }

  const speakerText = speakerMatch[2] ?? "";
  const leadingSpeakerWhitespace = speakerText.match(LEADING_WHITESPACE_PATTERN)?.[0] || "";
  const trailingSpeakerWhitespace = speakerText.match(TRAILING_WHITESPACE_PATTERN)?.[0] || "";

  return {
    speaker: speakerText.trim(),
    text: rawSection.text.slice(speakerMatch[0].length),
    format: {
      ...format,
      speakerPrefix: `${speakerMatch[1]}[${leadingSpeakerWhitespace}`,
      speakerSuffix: `${trailingSpeakerWhitespace}]${speakerMatch[3]}`,
    },
  };
}

export const parseNarrationSections = (text: string): NarrationSection[] =>
  splitRawSections(normalizeNotes(text)).map(parseSection);

export const getEffectiveSpeaker = (
  sections: readonly Pick<NarrationSection, "speaker">[],
  index: number,
): string => {
  for (let candidateIndex = index; candidateIndex >= 0; candidateIndex -= 1) {
    const speaker = sections[candidateIndex]?.speaker;
    if (speaker) {
      return speaker;
    }
  }

  return "";
};

export const formatNarrationSections = (sections: NarrationSection[]): string =>
  sections.reduce((notes, section, index) => {
    const separator = index > 0 ? section.format?.separatorBefore || DEFAULT_SECTION_SEPARATOR : "";

    if (section.speaker) {
      const speakerPrefix = section.format?.speakerPrefix || "[";
      const speakerSuffix = section.format?.speakerSuffix || "]";
      const speakerTag = `${speakerPrefix}${section.speaker}${speakerSuffix}`;
      const sectionText = section.text ? `${speakerTag}\n${section.text}` : speakerTag;
      return `${notes}${separator}${sectionText}`;
    }

    return `${notes}${separator}${section.text}`;
  }, "");

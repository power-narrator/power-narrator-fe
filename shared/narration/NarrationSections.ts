import { PROMPT_MARKER_PATTERN } from "./speakerName.js";

const DEFAULT_SECTION_SEPARATOR = "\n---\n";
const DEFAULT_PROMPT_PREFIX = "[prompt: ";
const DEFAULT_PROMPT_SUFFIX = "]";
const SECTION_DIVIDER_PATTERN = /^[ \t]*-{3,}[ \t]*(?:\n)?$/;
const BRACKETED_LINE_PATTERN = /^((?:[ \t]*\n)*[ \t]*)\[([^\]]*)\]([ \t]*)(?:\n|$)/;
const SAME_LINE_PADDING = { leading: /^[ \t]*/, trailing: /[ \t]*$/ };

export interface NarrationSection {
  speaker: string;
  prompt?: string;
  text: string;
  format?: {
    separatorBefore?: string;
    speakerPrefix?: string;
    speakerSuffix?: string;
    promptPrefix?: string;
    promptSuffix?: string;
  };
}

interface RawNarrationSection {
  separatorBefore?: string;
  text: string;
}

const normalizeNotes = (text: string): string => text.replaceAll(/\r\n|[\r\u2028\u2029]/g, "\n");

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

type BracketedLine = {
  length: number;
  lead: string;
  content: string;
  trailing: string;
};

function matchBracketedLine(text: string): BracketedLine | null {
  const match = text.match(BRACKETED_LINE_PATTERN);
  if (!match) {
    return null;
  }

  return {
    length: match[0].length,
    lead: match[1] ?? "",
    content: match[2] ?? "",
    trailing: match[3] ?? "",
  };
}

function splitPadding(text: string, padding: { leading: RegExp; trailing: RegExp }) {
  return {
    leading: text.match(padding.leading)?.[0] || "",
    trailing: text.match(padding.trailing)?.[0] || "",
    value: text.trim(),
  };
}

function readSpeaker(line: BracketedLine): Pick<NarrationSection, "speaker" | "format"> {
  const { leading, trailing, value } = splitPadding(line.content, SAME_LINE_PADDING);

  return {
    speaker: value,
    format: {
      speakerPrefix: `${line.lead}[${leading}`,
      speakerSuffix: `${trailing}]${line.trailing}`,
    },
  };
}

function readPrompt(line: BracketedLine): Pick<NarrationSection, "prompt" | "format"> | null {
  const marker = line.content.match(PROMPT_MARKER_PATTERN);
  if (!marker) {
    return null;
  }

  const prefix = line.content.startsWith(" ", marker[0].length) ? `${marker[0]} ` : marker[0];
  const value = line.content.slice(prefix.length);

  return {
    ...(value ? { prompt: value } : {}),
    format: {
      promptPrefix: `${line.lead}[${prefix}`,
      promptSuffix: `]${line.trailing}`,
    },
  };
}

function parseSection(
  rawSection: RawNarrationSection,
  knownSpeakers: ReadonlySet<string>,
): NarrationSection {
  let remaining = rawSection.text;
  let speaker = "";
  let prompt: string | undefined;
  let format: NarrationSection["format"] = rawSection.separatorBefore
    ? { separatorBefore: rawSection.separatorBefore }
    : {};

  const speakerLine = matchBracketedLine(remaining);
  if (speakerLine && !readPrompt(speakerLine) && knownSpeakers.has(speakerLine.content.trim())) {
    const speakerTag = readSpeaker(speakerLine);
    speaker = speakerTag.speaker;
    format = { ...format, ...speakerTag.format };
    remaining = remaining.slice(speakerLine.length);
  }

  const promptLine = matchBracketedLine(remaining);
  const promptTag = promptLine && readPrompt(promptLine);
  if (promptLine && promptTag) {
    prompt = promptTag.prompt;
    format = { ...format, ...promptTag.format };
    remaining = remaining.slice(promptLine.length);
  }

  return {
    speaker,
    ...(prompt ? { prompt } : {}),
    text: remaining,
    ...(format && Object.keys(format).length > 0 ? { format } : {}),
  };
}

export const parseNarrationSections = (
  text: string,
  knownSpeakers: Iterable<string>,
): NarrationSection[] => {
  const names = new Set(knownSpeakers);
  return splitRawSections(normalizeNotes(text)).map((section) => parseSection(section, names));
};

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

function withMarkerSpacing(prefix: string, prompt: string) {
  if (prefix.endsWith(" ") || !prompt.startsWith(" ")) {
    return { prefix, prompt };
  }

  return { prefix: `${prefix} `, prompt: prompt.slice(1) };
}

export const formatNarrationSections = (sections: NarrationSection[]): string =>
  sections.reduce((notes, section, index) => {
    const separator = index > 0 ? section.format?.separatorBefore || DEFAULT_SECTION_SEPARATOR : "";
    const tags: string[] = [];

    if (section.speaker) {
      const prefix = section.format?.speakerPrefix || "[";
      const suffix = section.format?.speakerSuffix || "]";
      tags.push(`${prefix}${section.speaker}${suffix}`);
    }

    if (section.prompt) {
      const { prefix, prompt } = withMarkerSpacing(
        section.format?.promptPrefix || DEFAULT_PROMPT_PREFIX,
        section.prompt,
      );
      const suffix = section.format?.promptSuffix || DEFAULT_PROMPT_SUFFIX;
      tags.push(`${prefix}${prompt}${suffix}`);
    }

    const head = tags.join("\n");
    if (!head) {
      return `${notes}${separator}${section.text}`;
    }

    return `${notes}${separator}${section.text ? `${head}\n${section.text}` : head}`;
  }, "");

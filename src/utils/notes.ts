import { DEFAULT_SPEAKER_VALUE } from "../constants/speaker";
import type { NoteSection } from "../types/notes";

export const parseNotes = (text: string): NoteSection[] => {
  if (!text || !text.trim()) {
    return [{ speaker: "", text: "" }];
  }

  // Normalize all line break variations to standard \n
  const normalizedText = text.replace(/\r\n|\r|\u2028|\u2029/g, '\n');

  // Split by --- but only consume the divider itself and surrounding horizontal whitespace,
  // plus up to one newline on either side to counteract the join("\n---\n") from formatNotes.
  return normalizedText.split(/\n?[ \t]*---[ \t]*\n?/g).map((part) => {
    // Only trim horizontal whitespace from start/end to preserve newlines
    const trimmedPart = part.replace(/^[ \t]+|[ \t]+$/g, '');
    
    if (trimmedPart.startsWith('[')) {
      const closingBracketIndex = trimmedPart.indexOf(']');
      if (closingBracketIndex !== -1 && closingBracketIndex < 50) {
        const speaker = trimmedPart.substring(1, closingBracketIndex).trim();
        let content = trimmedPart.substring(closingBracketIndex + 1);
        
        // Clean up ONLY horizontal whitespace and ONE newline immediately following the tag
        content = content.replace(/^[ \t]*\n?/, '');
        
        return { 
          speaker: speaker || DEFAULT_SPEAKER_VALUE, 
          text: content 
        };
      }
    }

    return { 
      speaker: DEFAULT_SPEAKER_VALUE, 
      text: trimmedPart 
    };
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
      const speakerPart = 
        section.speaker && section.speaker !== DEFAULT_SPEAKER_VALUE 
          ? `[${section.speaker}]\n` 
          : "";
      // Don't trim the text here, let the user's intentional newlines stay
      return `${speakerPart}${section.text}`;
    })
    .join("\n---\n")
    .trimEnd();
};

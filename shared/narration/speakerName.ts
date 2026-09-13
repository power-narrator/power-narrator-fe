/**
 * A bracketed line whose content opens with a word and a colon is reserved for
 * notes directives. The shape is deliberately wider than the markers the parser
 * recognises today, so a marker added later cannot strand a mapping that was
 * legal when it was created.
 */
export const DIRECTIVE_PATTERN = /^\s*([A-Za-z]+)\s*:/;

export function speakerNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Enter a speaker name.";
  }
  if (trimmed.includes("]") || trimmed.includes("\n")) {
    return 'A speaker name cannot contain "]" or a line break.';
  }
  if (DIRECTIVE_PATTERN.test(trimmed)) {
    return "A speaker name cannot start with a word followed by a colon; that shape is reserved for note directives such as [prompt: ...].";
  }

  return null;
}

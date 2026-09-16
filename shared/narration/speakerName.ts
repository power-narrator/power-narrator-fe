/**
 * Shared with the parser so a speaker name can never be read back as a prompt
 * marker.
 */
export const PROMPT_MARKER_PATTERN = /^\s*(?:p|prompt)\s*:/i;

export function speakerNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Enter a speaker name.";
  }
  if (trimmed.includes("]") || trimmed.includes("\n")) {
    return 'A speaker name cannot contain "]" or a line break.';
  }
  if (PROMPT_MARKER_PATTERN.test(trimmed)) {
    return "A speaker name cannot start with p: or prompt:; those mark an inline prompt such as [prompt: ...].";
  }

  return null;
}

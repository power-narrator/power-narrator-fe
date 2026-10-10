import { useState } from "react";
import { toSpeakerPrompt } from "../../shared/narration/prompt";

export type SpeakerPromptProps = {
  speakerLabel: string;
  value: string | undefined;
  supportsPrompt: boolean | undefined;
  onChange: (prompt: string | undefined) => void;
};

export type SpeakerPromptState = SpeakerPromptProps & {
  label: string;
  hasPrompt: boolean;
  locked: boolean;
  opened: boolean;
  toggle: () => void;
};

export function useSpeakerPrompt(props: SpeakerPromptProps): SpeakerPromptState {
  const { speakerLabel, value, supportsPrompt } = props;
  const hasPrompt = Boolean(toSpeakerPrompt(value));
  const [closedPrompt, setClosedPrompt] = useState<string>();
  const [emptyPromptOpened, setEmptyPromptOpened] = useState(false);
  const locked = hasPrompt && supportsPrompt !== false;
  const opened = locked || (hasPrompt ? value !== closedPrompt : emptyPromptOpened);

  const toggle = () => {
    if (hasPrompt) {
      setClosedPrompt(opened ? value : undefined);
    } else {
      setClosedPrompt(undefined);
      setEmptyPromptOpened(!opened);
    }
  };

  return { ...props, label: `Prompt for ${speakerLabel}`, hasPrompt, locked, opened, toggle };
}

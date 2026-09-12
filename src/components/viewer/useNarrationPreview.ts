import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getEffectiveSpeaker,
  parseNarrationSections,
  type NarrationSection,
} from "../../../shared/narration/NarrationSections";
import { DEFAULT_SPEAKER_VALUE } from "../../../shared/narration/speaker";
import type { PreviewSpeakerChoice } from "../../../shared/types/narration";
import { useAudio } from "../../context/useAudio";
import { getErrorMessage } from "../../utils/errors";

interface PreviewRequestState {
  ownerId: string;
  target: string;
  generating: boolean;
}

interface PreviewRequestCoordinator {
  request: PreviewRequestState | null;
  claim: (ownerId: string, target: string) => number;
  isCurrent: (token: number) => boolean;
  finish: (token: number) => void;
  clear: (ownerId: string, token?: number) => void;
}

const NarrationPreviewContext = createContext<PreviewRequestCoordinator | undefined>(undefined);

export function NarrationPreviewProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PreviewRequestState | null>(null);
  const currentTokenRef = useRef(0);
  const currentOwnerRef = useRef<string | null>(null);

  const claim = useCallback((ownerId: string, target: string) => {
    currentTokenRef.current += 1;
    currentOwnerRef.current = ownerId;
    setRequest({ ownerId, target, generating: true });
    return currentTokenRef.current;
  }, []);

  const isCurrent = useCallback((token: number) => currentTokenRef.current === token, []);

  const finish = useCallback((token: number) => {
    if (currentTokenRef.current !== token) return;
    setRequest((current) => (current ? { ...current, generating: false } : null));
  }, []);

  const clear = useCallback((ownerId: string, token?: number) => {
    if (token !== undefined && currentTokenRef.current !== token) return;
    if (currentOwnerRef.current !== ownerId) return;

    currentTokenRef.current += 1;
    currentOwnerRef.current = null;
    setRequest((current) => (current?.ownerId === ownerId ? null : current));
  }, []);

  const coordinator = useMemo(
    () => ({ request, claim, isCurrent, finish, clear }),
    [request, claim, isCurrent, finish, clear],
  );

  // The coordinator only exposes callbacks; the refs it closes over are never read
  // during render, so the taint the rule reports here is a false positive.
  // oxlint-disable-next-line react/refs
  return createElement(NarrationPreviewContext.Provider, { value: coordinator }, children);
}

function usePreviewRequestCoordinator() {
  const coordinator = useContext(NarrationPreviewContext);
  if (!coordinator) {
    throw new Error("useNarrationPreview must be used within a NarrationPreviewProvider");
  }
  return coordinator;
}

interface NarrationPreviewOptions {
  id: string;
  slideIndex: number;
  sectionIndex: number;
  slideNotes: string;
  section: NarrationSection;
  onFocus: () => void;
  getTextarea?: () => HTMLTextAreaElement | null;
}

export function useNarrationPreview(options: NarrationPreviewOptions) {
  const effectiveSpeaker = getEffectiveSpeaker(
    parseNarrationSections(options.slideNotes),
    options.sectionIndex,
  );
  const {
    activeId,
    isPlaying: audioIsPlaying,
    currentTime,
    duration,
    play: playAudio,
    stop: stopAudio,
    seek,
    setSeeking,
  } = useAudio();
  const { request, claim, isCurrent, finish, clear } = usePreviewRequestCoordinator();
  const [lastPlayedSpeaker, setLastPlayedSpeaker] = useState<string | null>(null);
  const ownedTokenRef = useRef<number | null>(null);
  const activeAudioIdRef = useRef(activeId);
  useEffect(() => {
    activeAudioIdRef.current = activeId;
  });
  const isCurrentAudio = activeId === options.id;
  const ownsVisibleRequest = request?.ownerId === options.id;
  const activeTarget = ownsVisibleRequest
    ? request.target
    : isCurrentAudio
      ? lastPlayedSpeaker
      : null;
  const isGenerating = ownsVisibleRequest && request.generating;

  const stop = useCallback(() => {
    const token = ownedTokenRef.current;
    if (token !== null) clear(options.id, token);
    ownedTokenRef.current = null;
    if (activeId === options.id) stopAudio();
  }, [activeId, clear, options.id, stopAudio]);

  useEffect(() => {
    if (!audioIsPlaying && activeId === null && !isGenerating) {
      clear(options.id);
      ownedTokenRef.current = null;
    }
  }, [activeId, audioIsPlaying, clear, isGenerating, options.id]);

  useEffect(
    () => () => {
      const token = ownedTokenRef.current;
      if (token !== null) clear(options.id, token);
      ownedTokenRef.current = null;
      if (activeAudioIdRef.current === options.id) stopAudio();
    },
    [clear, options.id, stopAudio],
  );

  const play = useCallback(
    async (speakerChoice: PreviewSpeakerChoice) => {
      const target =
        speakerChoice.kind === "effective"
          ? effectiveSpeaker
          : speakerChoice.kind === "default"
            ? DEFAULT_SPEAKER_VALUE
            : speakerChoice.speaker;
      if (activeTarget === target) {
        stop();
        return;
      }

      const textarea = options.getTextarea?.();
      const text = textarea
        ? textarea.selectionStart === textarea.selectionEnd
          ? textarea.value
          : textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
        : options.section.text;
      if (!text.trim()) {
        alert("No text to preview.");
        return;
      }

      options.onFocus();
      const token = claim(options.id, target);
      ownedTokenRef.current = token;
      setLastPlayedSpeaker(target);

      try {
        const preview = await window.electronAPI.prepareNarrationPreview({
          slideIndex: options.slideIndex,
          sectionIndex: options.sectionIndex,
          notes: options.slideNotes,
          text,
          speakerChoice,
        });
        if (!isCurrent(token)) return;

        const buffer = Uint8Array.from(preview.audio).buffer;
        const url = URL.createObjectURL(new Blob([buffer], { type: preview.mediaType }));
        playAudio(options.id, url);
      } catch (error: unknown) {
        if (!isCurrent(token)) return;
        alert(`Failed to play audio: ${getErrorMessage(error)}`);
        clear(options.id, token);
        ownedTokenRef.current = null;
      } finally {
        finish(token);
      }
    },
    [activeTarget, claim, clear, effectiveSpeaker, finish, isCurrent, options, playAudio, stop],
  );

  return {
    effectiveSpeaker,
    activeTarget,
    lastPlayedSpeaker,
    isGenerating,
    isPlaying: audioIsPlaying && isCurrentAudio,
    currentTime: isCurrentAudio ? currentTime : 0,
    duration: isCurrentAudio ? duration : 0,
    isCurrentAudio,
    play,
    stop,
    seek,
    setSeeking,
  };
}

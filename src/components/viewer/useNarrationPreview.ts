import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NarrationSection } from "../../../shared/narration/NarrationSections";
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

  return createElement(
    NarrationPreviewContext.Provider,
    { value: { request, claim, isCurrent, finish, clear } },
    children,
  );
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
  activeAudioIdRef.current = activeId;
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
    async (target: string, previewSpeaker?: string) => {
      if (activeTarget === target) {
        stop();
        return;
      }

      const textarea = options.getTextarea?.();
      const text = textarea
        ? textarea.selectionStart === textarea.selectionEnd
          ? textarea.value
          : textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
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
          ...(previewSpeaker !== undefined ? { previewSpeaker } : {}),
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
    [activeTarget, claim, clear, finish, isCurrent, options, playAudio, stop],
  );

  return {
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

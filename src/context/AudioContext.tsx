import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { AudioContext } from "./audio-context";

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const isSeekingRef = useRef(false);

  const revokeCurrentUrl = useCallback(() => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (!isSeekingRef.current) {
        setCurrentTime(audio.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      revokeCurrentUrl();
      setIsPlaying(false);
      setActiveId(null);
      setCurrentUrl(null);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.pause();
      revokeCurrentUrl();
      audioRef.current = null;
    };
  }, [revokeCurrentUrl]);

  const stop = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    revokeCurrentUrl();
    setActiveId(null);
    setCurrentUrl(null);
    setIsPlaying(false);
  }, [revokeCurrentUrl]);

  const play = useCallback(
    (id: string, url: string) => {
      if (!audioRef.current) return;

      const isSameId = activeId === id;
      const isSameUrl = currentUrl === url;

      if (isSameId && isSameUrl && isPlaying) {
        stop();
        return;
      }

      if (!isSameId || !isSameUrl) {
        audioRef.current.pause();
        revokeCurrentUrl();
        audioRef.current.src = url;
        currentUrlRef.current = url;
        audioRef.current.currentTime = 0;
        setActiveId(id);
        setCurrentUrl(url);
      }

      audioRef.current.play().catch((error) => {
        console.error("Playback failed:", error);
        if (currentUrlRef.current !== url) {
          return;
        }

        revokeCurrentUrl();
        setActiveId(null);
        setCurrentUrl(null);
        setIsPlaying(false);
      });
    },
    [activeId, currentUrl, isPlaying, revokeCurrentUrl, stop],
  );

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const setSeeking = useCallback((seeking: boolean) => {
    isSeekingRef.current = seeking;
  }, []);

  const value = useMemo(
    () => ({
      activeId,
      isPlaying,
      currentTime,
      duration,
      play,
      stop,
      seek,
      setSeeking,
    }),
    [activeId, isPlaying, currentTime, duration, play, stop, seek, setSeeking],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
};

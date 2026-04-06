import React, { createContext, useContext, useRef, useState, useEffect } from "react";

interface AudioContextType {
  activeId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  play: (id: string, url: string) => void;
  stop: () => void;
  seek: (time: number) => void;
  setSeeking: (seeking: boolean) => void;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isSeekingRef = useRef(false);

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
      audioRef.current = null;
    };
  }, []);

  const play = (id: string, url: string) => {
    if (!audioRef.current) return;

    const isSameId = activeId === id;
    const isSameUrl = currentUrl === url;

    if (isSameId && isSameUrl && isPlaying) {
      stop();
      return;
    }

    if (!isSameId || !isSameUrl) {
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.currentTime = 0;
      setActiveId(id);
      setCurrentUrl(url);
    }

    audioRef.current.play().catch((error) => {
      console.error("Playback failed:", error);
      setActiveId(null);
      setCurrentUrl(null);
      setIsPlaying(false);
    });
  };

  const stop = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setActiveId(null);
    setCurrentUrl(null);
    setIsPlaying(false);
  };

  const seek = (time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const setSeeking = (seeking: boolean) => {
    isSeekingRef.current = seeking;
  };

  return (
    <AudioContext.Provider
      value={{
        activeId,
        isPlaying,
        currentTime,
        duration,
        play,
        stop,
        seek,
        setSeeking,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
};

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }
  return context;
};

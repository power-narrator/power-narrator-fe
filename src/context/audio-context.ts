import { createContext } from "react";

export interface AudioContextType {
  activeId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  play: (id: string, url: string) => void;
  stop: () => void;
  seek: (time: number) => void;
  setSeeking: (seeking: boolean) => void;
}

export const AudioContext = createContext<AudioContextType | undefined>(undefined);

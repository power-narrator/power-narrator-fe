import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Voice } from "../types/voice";

interface SettingsContextValue {
  mappings: Record<string, Voice>;
  saveMappings: (newMappings: Record<string, Voice>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [mappings, setMappings] = useState<Record<string, Voice>>({});

  const loadSettings = useCallback(async () => {
    const speakerMappings = await window.electronAPI.getSpeakerMappings();

    return speakerMappings ?? {};
  }, []);

  const saveMappings = useCallback(async (newMappings: Record<string, Voice>) => {
    setMappings(newMappings);
    await window.electronAPI.setSpeakerMappings(newMappings);
  }, []);

  useEffect(() => {
    loadSettings()
      .then((speakerMappings) => {
        setMappings(speakerMappings);
      })
      .catch((error) => {
        console.error("Failed to load settings:", error);
      });
  }, [loadSettings]);

  const value = useMemo(
    () => ({
      mappings,
      saveMappings,
    }),
    [mappings, saveMappings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export { SettingsContext };

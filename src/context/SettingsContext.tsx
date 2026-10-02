import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Settings } from "../../shared/types/settings";
import type { SpeakerMapping } from "../../shared/types/tts";

type Mappings = Record<string, SpeakerMapping>;

type SettingsContextValue = {
  mappings: Mappings;
  saveSettings: (settings: Settings) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [mappings, setMappings] = useState<Mappings>({});
  const savedBeforeLoad = useRef(false);

  const saveSettings = useCallback(async (settings: Settings) => {
    const result = await window.electronAPI.saveSettings(settings);
    if (!result.success) {
      throw new Error(result.message);
    }

    savedBeforeLoad.current = true;
    setMappings(settings.speakerMappings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getSpeakerMappings()
      .then((speakerMappings) => {
        if (!cancelled && !savedBeforeLoad.current) setMappings(speakerMappings ?? {});
      })
      .catch((error) => {
        if (!cancelled) console.error("Failed to load settings:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ mappings, saveSettings }), [mappings, saveSettings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export { SettingsContext };

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SpeakerMapping } from "../../shared/types/tts";

type Mappings = Record<string, SpeakerMapping>;
type MappingsUpdater = (current: Mappings) => Mappings;

type SettingsContextValue = {
  mappings: Mappings;
  updateMappings: (update: MappingsUpdater) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [mappings, setMappings] = useState<Mappings>({});
  const latestMappings = useRef(mappings);
  const loadedMappings = useRef<Mappings | null>(null);
  const editsBeforeLoad = useRef<MappingsUpdater[]>([]);
  const initialLoad = useRef<Promise<void>>(Promise.resolve());
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());

  const updateMappings = useCallback((update: MappingsUpdater) => {
    const next = update(latestMappings.current);
    if (next === latestMappings.current) {
      return Promise.resolve();
    }

    latestMappings.current = next;
    if (loadedMappings.current === null) {
      editsBeforeLoad.current.push(update);
    }
    setMappings(next);

    const write = pendingWrite.current.then(async () => {
      await initialLoad.current;
      const nextToPersist = update(loadedMappings.current ?? {});
      loadedMappings.current = nextToPersist;
      const result = await window.electronAPI.setSpeakerMappings(nextToPersist);
      if (!result.success) {
        throw new Error(result.message);
      }
    });
    pendingWrite.current = write.catch(() => {});
    return write;
  }, []);

  useEffect(() => {
    let cancelled = false;
    initialLoad.current = window.electronAPI
      .getSpeakerMappings()
      .then((speakerMappings) => {
        if (cancelled) return;
        loadedMappings.current = speakerMappings ?? {};
        latestMappings.current = editsBeforeLoad.current.reduce(
          (current, update) => update(current),
          loadedMappings.current,
        );
        editsBeforeLoad.current = [];
        setMappings(latestMappings.current);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load settings:", error);
          loadedMappings.current = {};
          editsBeforeLoad.current = [];
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      mappings,
      updateMappings,
    }),
    [mappings, updateMappings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export { SettingsContext };

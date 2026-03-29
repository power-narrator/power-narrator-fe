import { createContext, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Voice } from '../types/voice';

interface SettingsContextValue {
    mappings: Record<string, Voice>;
    xmlCliEnabled: boolean;
    refreshSettings: () => Promise<void>;
    saveMappings: (newMappings: Record<string, Voice>) => Promise<void>;
    setXmlCliEnabled: (enabled: boolean) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [mappings, setMappings] = useState<Record<string, Voice>>({});
    const [xmlCliEnabled, setXmlCliEnabledState] = useState(false);

    const loadSettings = useCallback(async () => {
        const [speakerMappings, xmlEnabled] = await Promise.all([
            window.electronAPI.getSpeakerMappings(),
            window.electronAPI.getXmlCliEnabled(),
        ]);

        return {
            speakerMappings: speakerMappings ?? {},
            xmlEnabled,
        };
    }, []);

    const refreshSettings = useCallback(async () => {
        const { speakerMappings, xmlEnabled } = await loadSettings();

        setMappings(speakerMappings);
        setXmlCliEnabledState(xmlEnabled);
    }, [loadSettings]);

    const saveMappings = useCallback(async (newMappings: Record<string, Voice>) => {
        setMappings(newMappings);
        await window.electronAPI.setSpeakerMappings(newMappings);
    }, []);

    const setXmlCliEnabled = useCallback(async (enabled: boolean) => {
        setXmlCliEnabledState(enabled);
        await window.electronAPI.setXmlCliEnabled(enabled);
    }, []);

    const value = {
        mappings,
        xmlCliEnabled,
        refreshSettings,
        saveMappings,
        setXmlCliEnabled,
    };

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export { SettingsContext };

import { createContext, useState } from 'react';
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

    async function refreshSettings() {
        const [speakerMappings, xmlEnabled] = await Promise.all([
            window.electronAPI.getSpeakerMappings(),
            window.electronAPI.getXmlCliEnabled(),
        ]);

        setMappings(speakerMappings ?? {});
        setXmlCliEnabledState(xmlEnabled);
    }

    async function saveMappings(newMappings: Record<string, Voice>) {
        setMappings(newMappings);
        await window.electronAPI.setSpeakerMappings(newMappings);
    }

    async function setXmlCliEnabled(enabled: boolean) {
        setXmlCliEnabledState(enabled);
        await window.electronAPI.setXmlCliEnabled(enabled);
    }

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

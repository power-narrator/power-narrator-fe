import { useState, useEffect } from 'react';
import { Select, Group, Loader, Text } from '@mantine/core';

export interface Voice {
    name: string;
    languageCodes: string[];
    ssmlGender: string;
    provider?: string;
}

interface VoiceSelectorProps {
    value: Voice | null;
    onChange: (voice: Voice) => void;
    providerFilter?: 'gcp' | 'local';
    refreshBit?: number;
}

export function VoiceSelector({ value, onChange, providerFilter, refreshBit }: VoiceSelectorProps) {
    const [voices, setVoices] = useState<Voice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchVoices = async () => {
            if (!window.electronAPI) return;
            setLoading(true);
            try {
                const fetchedVoices: Voice[] = await window.electronAPI.getVoices();
                console.log('Fetched voices:', fetchedVoices);
                setVoices(fetchedVoices);
                setError(null);
            } catch (err: any) {
                console.error("Error fetching voices:", err);
                setError("Failed to load voices");
            } finally {
                setLoading(false);
            }
        };

        fetchVoices();
    }, [refreshBit, providerFilter]); // Re-fetch on manual refresh or provider switch

    const handleChange = (selectedValue: string | null) => {
        const voice = voices.find(v => v.name === selectedValue);
        if (voice) {
            onChange(voice);
        }
    };

    if (loading) return <Loader size="xs" />;

    if (error) return <Text size="xs" c="red">{error}</Text>;

    const filteredVoices = providerFilter
        ? voices.filter(v => v.provider === providerFilter)
        : voices;

    return (
        <Group>
            <Select
                placeholder="Select Voice"
                data={filteredVoices.map(v => ({
                    value: v.name,
                    label: `${v.name.split('/').pop()} (${v.provider === 'gcp' ? 'Google' : 'Local'}, ${v.ssmlGender})`
                }))}
                value={value?.name || null}
                onChange={handleChange}
                searchable
                size="xs"
                w={250}
            />
        </Group>
    );
}

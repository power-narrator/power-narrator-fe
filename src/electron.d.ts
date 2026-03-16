export interface Slide {
    index: number;
    image: string;
    src: string; // The full path/url
    notes: string;
}

export interface ConvertResponse {
    success: boolean;
    slides: Slide[];
    error?: string;
}

declare global {
    interface Window {
        electronAPI: {
            convertPptx: (filePath: string) => Promise<ConvertResponse>;
            onConversionUpdate: (callback: (event: any, value: any) => void) => void;
            getPathForFile: (file: File) => string;
            selectFile: () => Promise<string | null>;
            saveAllNotes: (filePath: string, slides: Slide[]) => Promise<{ success: boolean; error?: string }>;
            getVoices: () => Promise<any[]>;
            getGcpKeyPath: () => Promise<string | null>;
            setGcpKey: () => Promise<{ success: boolean; path?: string; error?: string }>;
            setInsertMethod: (method: string) => Promise<void>;
            getSpeakerMappings: () => Promise<Record<string, any>>;
            setSpeakerMappings: (mappings: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
            getTtsProvider: () => Promise<'gcp' | 'local'>;
            getXmlCliEnabled: () => Promise<boolean>;
            setXmlCliEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        };
    }
}

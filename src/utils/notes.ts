import { DEFAULT_SPEAKER_VALUE } from '../constants/speaker';
import type { NoteSection } from '../types/notes';

export const parseNotes = (text: string): NoteSection[] => {
    if (!text) {
        return [{ speaker: '', text: '' }];
    }

    return text.split(/\r?\n---\r?\n/g).map((part) => {
        const match = part.match(/^\[([^\]]+)\]\n([\s\S]*)$/);

        if (match) {
            return { speaker: match[1], text: match[2] };
        }

        return { speaker: DEFAULT_SPEAKER_VALUE, text: part };
    });
};

export const formatNotes = (sections: NoteSection[]): string => {
    return sections
        .map((section) => {
            const speakerPart = section.speaker !== DEFAULT_SPEAKER_VALUE ? `[${section.speaker}]\n` : '';
            return `${speakerPart}${section.text}`;
        })
        .join('\n---\n');
};

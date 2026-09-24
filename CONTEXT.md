# Power Narrator

Power Narrator prepares spoken narration from PowerPoint slide notes for preview and insertion into a presentation.

## Language

**Slide-note section**:
A speaker-attributable unit of a slide's presenter notes: its narration text, optionally preceded by a speaker tag and an inline prompt.
_Avoid_: Note block, narration block, note segment

**Narration preparation**:
The conversion of slide-note sections and speaker mappings into synthesized audio suitable for preview or PowerPoint insertion.
_Avoid_: Speech pipeline, audio generation flow

**Effective speaker**:
The speaker selected for a slide-note section after slide-local inheritance. An unspecified section inherits the nearest earlier explicitly selected speaker within the same slide.

**Speaker mapping**:
The association between a speaker name and the voice selection used to narrate it, together with an optional preset prompt. One mapping set may contain voices from different providers.

**Default voice**:
An explicitly configured voice used when a section has no explicitly selected speaker and no earlier section within the same slide establishes an effective speaker.
_Avoid_: Inherited speaker, provider default

**Synthesized speech**:
The audio bytes a TTS provider returned together with the media type of its output encoding.
_Avoid_: Audio blob, mp3 bytes

**Unmapped speaker**:
A speaker that has a mapping but no configured voice in it.

**Speaker tag**:
A bracketed line at the head of a slide-note section whose name appears in the speaker mappings. A bracketed line that matches neither a mapping nor the inline-prompt marker remains narration text.

**Voice option**:
A catalogue entry a TTS provider publishes for the voice picker, naming one voice and the models it can be synthesized with, each model carrying the languages it offers.
_Avoid_: Available voice, provider voice, voice entry

**Voice**:
The durable record of a chosen voice: which provider, which named voice, which model, and which language. A voice outlives the catalogue entry it was chosen from, so narration never depends on a catalogue being reachable.
_Avoid_: Voice selection, saved voice, stored voice

**Model**:
The engine a provider synthesizes a voice with.
_Avoid_: Engine, voice family, voice type

**Promptable voice**:
A voice whose model accepts a speaker prompt alongside the text.
_Avoid_: Gemini voice, LLM voice

**Speaker prompt**:
A natural-language instruction that steers how a promptable voice delivers its text, distinct from the text being spoken.
_Avoid_: System prompt, style prompt, instruction

**Preset prompt**:
The speaker prompt configured on a speaker mapping, applied to every section that speaker narrates.

**Inline prompt**:
The speaker prompt written into a single slide-note section, applied only to that section and never inherited by later sections. It is appended to the preset prompt rather than replacing it.
_Avoid_: Section prompt, override prompt

**Slide index**:
The 0-based ordinal identifying a slide within its presentation for internal addressing. It remains the presentation-wide ordinal when slides appear in a subset or a different order; it is not their incidental position in that collection.
_Avoid_: Slide position, slide id, 0-based slide number

**Slide number**:
The 1-based ordinal by which an author recognizes a slide, derived by adding one to its slide index. It is a human-facing label rather than a separate slide identity or internal address.
_Avoid_: 1-based slide index, slide position, slide id

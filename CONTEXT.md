# Power Narrator

Power Narrator prepares spoken narration from PowerPoint slide notes for preview and insertion into a presentation.

## Language

**Narration preparation**:
The conversion of slide-note sections and speaker mappings into synthesized audio suitable for preview or PowerPoint insertion.
_Avoid_: Speech pipeline, audio generation flow

**Effective speaker**:
The speaker selected for a slide-note section after slide-local inheritance. An unspecified section inherits the nearest earlier explicitly selected speaker within the same slide.

**Speaker mapping**:
The association between a speaker name and the voice selection used to narrate it, together with an optional preset prompt. One mapping set may contain voices from different providers.

**Default voice**:
An explicitly configured voice used when a section has no explicitly selected speaker and no earlier section within the same slide establishes an effective speaker. Narration preparation fails if no default voice is configured.
_Avoid_: Inherited speaker, provider default

**Synthesized speech**:
The audio bytes a TTS provider returned together with the media type of its output encoding. Cache filenames and preview playback both follow that encoding rather than assuming MP3.
_Avoid_: Audio blob, mp3 bytes

**Unmapped speaker**:
A speaker that has a mapping but no configured voice in it. Narration preparation fails instead of synthesizing with an unintended voice. A bracketed line naming no mapping at all is not a speaker tag, so it stays in the section text rather than becoming an unmapped speaker.

**Speaker tag**:
A bracketed line at the head of a slide-note section naming a speaker. Only a name a speaker mapping carries is one: notes parsing is mapping-dependent, and a bracketed line that matches neither a prompt marker nor a mapping name is narration text — which is what keeps a Gemini style tag such as `[sigh]` intact and a mistyped speaker name visible.

**Voice option**:
A catalogue entry a TTS provider publishes for the voice picker, naming one voice and the models it can be synthesized with, each model carrying the languages it offers. A catalogue is only available while the provider's credentials are configured.
_Avoid_: Available voice, provider voice, voice entry

**Voice**:
The durable record of a chosen voice: which provider, which named voice, which model, and which language. A voice outlives the catalogue entry it was chosen from, so narration never depends on a catalogue being reachable.
_Avoid_: Voice selection, saved voice, stored voice

**Model**:
The engine a provider synthesizes a voice with. Some providers name the model in the request; others imply it from the voice itself, so a model is always part of a voice even when it never reaches the provider.
_Avoid_: Engine, voice family, voice type

**Promptable voice**:
A voice whose model accepts a speaker prompt alongside the text. Narration of a section carrying a prompt still proceeds when the voice is not promptable; the prompt is dropped and the user is warned.
_Avoid_: Gemini voice, LLM voice

**Speaker prompt**:
A natural-language instruction that steers how a promptable voice delivers its text, distinct from the text being spoken. An absent prompt and an empty prompt are the same thing everywhere: neither is stored, written into notes, nor sent to a provider.
_Avoid_: System prompt, style prompt, instruction

**Preset prompt**:
The speaker prompt configured on a speaker mapping, applied to every section that speaker narrates.

**Inline prompt**:
The speaker prompt written into a single slide-note section, applied only to that section and never inherited by later sections. It is appended to the preset prompt rather than replacing it.
_Avoid_: Section prompt, override prompt

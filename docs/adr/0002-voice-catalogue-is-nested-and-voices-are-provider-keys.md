# The voice catalogue is nested, and a stored voice holds provider keys rather than provider ids

A provider publishes voice options as a nested catalogue: a voice offers models, and each model offers languages. A stored voice collapses that to one of each. The nesting exists because the alternatives are worse — a flat entry per combination is roughly ten thousand rows for one provider, and a flat union of models and languages would offer combinations that do not exist, since coverage differs between models of the same voice.

The picker renders one shape for every provider and hides a level whose array holds a single entry, so a provider with no model or language choice renders as a bare voice dropdown without a second code path. Flatness is emergent, not a mode.

Consequently a stored voice holds the provider's *key* for a voice, not necessarily the identifier the provider's API accepts. Where an identifier encodes the model and language, the provider composes it at synthesis time from the stored voice, model, and language. Do not "fix" this by storing the composed identifier: it would make the stored record unable to express a voice whose language is chosen separately.

## Consequences

Switching a speaker's model can invalidate its language, so the settings UI clamps the language to one the newly chosen model offers. Providers own two mappings the rest of the app never sees: a model's display label, and whether that model is named in the request or implied by the voice identifier.

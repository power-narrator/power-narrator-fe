# The voice catalogue is nested, and a stored voice holds provider keys rather than provider ids

A provider publishes voice options as a nested catalogue: a voice offers models, and each model offers languages. A stored voice collapses that to one of each.

The nesting exists because both flat alternatives fail. A flat entry per combination runs to five figures for a single provider. A flat union of models and languages offers combinations that do not exist, because coverage differs between models of the same voice. Nesting makes an unavailable combination unrepresentable rather than merely unselected.

Consequently a stored voice holds the provider's *key* for a voice, not necessarily the identifier the provider's API accepts. Where an identifier encodes the model and language, the provider composes it at synthesis from the stored voice, model, and language, and decomposes it when reading its own catalogue. Do not "fix" this by storing the composed identifier: it would make the stored record unable to express a voice whose language is chosen separately.

## Consequences

A voice option's label can only name what is true of the voice itself, since its model and language are not yet chosen when the option is displayed.

Choosing a model constrains which languages are available, so the two choices cannot be made independently.

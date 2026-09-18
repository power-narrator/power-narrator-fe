# The voice catalogue is nested, and a stored voice holds provider keys

A provider publishes voice options as a nested catalogue: a voice offers models, and each model offers languages. A stored voice records the chosen provider, voice key, model, and language.

The nesting avoids both problematic flat alternatives. An entry for every combination makes the catalogue impractically large. Independent lists of models and languages admit combinations the provider does not offer. Nesting keeps those unavailable combinations out of the catalogue.

The voice key is the provider's stable identity for the voice, not necessarily the full name accepted in a synthesis request. Request names are not stored because they may combine the voice key with the selected model or language. Storing one would prevent those choices from remaining independent.

## Consequences

A voice option's label can only name what is true of the voice itself, since its model and language are not yet chosen when the option is displayed.

Choosing a model constrains which languages are available, so the two choices cannot be made independently.

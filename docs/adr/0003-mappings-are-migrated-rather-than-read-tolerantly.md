# Saved mappings are migrated once, not read tolerantly forever

Reshaping the stored speaker mapping could have been absorbed by a read that converts whatever shape it finds, every time. That was the initial plan: no version scheme, no rewrite step, and a bad record degrades alone rather than taking the settings file with it.

We migrate instead, because a tolerant read has no expiry. It sits in the read path indefinitely and nothing ever tells you it is safe to remove — it becomes sediment. A migration gated on a stored version runs once, leaves every read path accepting exactly one shape, and can be deleted outright when no installation can still be on the old version. That deletability is the whole point, and the version marker is what makes it safe.

The same reasoning rejects permanent legacy-handling code anywhere else: recovering an old record must reuse what the provider already does for its own catalogue, never a parallel path that exists only to read the old format.

## Consequences

No backup is taken. The worst conversion failure leaves a speaker visibly unconfigured, whose fix is re-picking a voice — not worth a file that would outlive the migration.

A record that cannot be converted keeps its speaker alias and any prompt, with the voice unconfigured, and behaves like a mapping added but never configured. Dropping it would lose user configuration silently; aborting would block the app over a single bad row.

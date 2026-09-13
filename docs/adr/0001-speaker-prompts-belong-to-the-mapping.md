# Speaker prompts belong to the mapping, not the voice

Promptable voices accept a natural-language instruction alongside the text, and the feature was first framed as "a prompt sent whenever that voice is used" — which would have keyed prompts by voice. We key them by speaker mapping instead: a prompt is a trait of the speaker ("Alice is the conspiratorial one"), not of the voice, so two speakers sharing one voice keep independent prompts.

The deciding constraint was retention. A user testing a deck often switches a speaker to a cheaper, non-promptable voice and back again; if the prompt lived on the voice, that round trip would either discard the prompt or leak it onto every other speaker using the same voice. Keying by mapping makes retention automatic.

## Consequences

A prompt can outlive the promptability of the voice beside it. Narration proceeds and the prompt is ignored, rather than failing a whole-deck save over an instruction the user may have parked deliberately.

# Play Across Slides follows PowerPoint’s checkbox on Mac

The application treats section audio’s Play Across Slides setting as enabled or disabled. For native Mac PowerPoint, PowerPoint’s checkbox defines that state, and its native Ribbon control applies changes. Numeric slide limits remain PowerPoint’s concern. Enabled means audio can continue onto subsequent slides under its playback settings; it does not promise automatic start or playback through the entire presentation. Other providers retain their existing behavior.

Direct numeric playback assignments on Mac can damage unrelated animations, and numeric reads have returned inconsistent results. Configuring playback in a hidden helper presentation avoids damage to unrelated shapes but introduces reconstruction of the audio’s own effects and triggers. The Ribbon approach preserves more of the tested author settings and avoids that reconstruction, so it is the sole playback-changing route, without an automatic fallback to those alternatives.

This choice requires temporary navigation and audio selection during loading and saving, with the author’s editing context restored afterward. Replacement must retain supported author customization; unreadable state and unsupported setups must fail explicitly. The native control can introduce the stored timing differences described in the research reference; this is not a guarantee of exact preservation or proven slideshow equivalence.

The [research reference](../powerpoint/mac-audio-playback.md) preserves findings from both investigations, including [animation-copying behavior and limits](../powerpoint/mac-audio-playback.md#animation-copying-findings), alternative-method outcomes and observed timing differences.

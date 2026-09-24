# Slides are addressed by slide index

Internal workflows address a slide by its slide index: the presentation-wide, 0-based ordinal that stays meaningful when slides reach a caller as a subset or in a different order. The 1-based slide number is derived only at boundaries that require it, such as author-facing labels and PowerPoint automation. Keeping the two ordinals distinct prevents a plain number from being interpreted in the wrong coordinate system.

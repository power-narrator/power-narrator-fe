# Slides are addressed by slide index

Internal workflows address a slide by its slide index: the presentation-wide, 0-based ordinal that stays meaningful when slides reach a caller as a subset or in a different order. The 1-based slide number is derived from it, and only where something outside the application requires it — author-facing labels, and the native PowerPoint adapters whose automation counts slides from one. Because both are plain integers and differ by one, they are distinct branded types converted only at `shared/slides/slideCoordinates.ts`, so no object or parameter can be read as either.

Workflows are migrated to this addressing one at a time. Until a workflow moves, it carries the legacy 1-based value as an unbranded number — including the `index` field still on the structured slide contract, and parameters elsewhere named `slideIndex` that hold a slide number — and converts through that same seam at its edge.

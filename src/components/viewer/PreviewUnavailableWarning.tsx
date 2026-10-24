import { Alert, Anchor, Collapse, Text } from "@mantine/core";
import { useId, useState } from "react";
import { slideNumberOf, type SlideNumber } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";

type PreviewUnavailableWarningProps = {
  slides: readonly Pick<Slide, "slideIndex" | "preview">[];
};

function formatSlideNumberRanges(slideNumbers: readonly SlideNumber[]): string {
  const ranges: Array<[first: SlideNumber, last: SlideNumber]> = [];
  for (const slideNumber of slideNumbers) {
    const current = ranges.at(-1);
    if (current && current[1] + 1 === slideNumber) {
      current[1] = slideNumber;
    } else {
      ranges.push([slideNumber, slideNumber]);
    }
  }
  return ranges
    .map(([first, last]) => (first === last ? `${first}` : `${first}–${last}`))
    .join(", ");
}

export function PreviewUnavailableWarning({ slides }: PreviewUnavailableWarningProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const missing = slides
    .filter((slide) => slide.preview === null)
    .map((slide) => slideNumberOf(slide.slideIndex))
    .toSorted((a, b) => a - b);

  if (missing.length === 0) {
    return null;
  }

  return (
    <Alert
      color="yellow"
      variant="light"
      py="xs"
      title={`${missing.length === 1 ? "Preview" : "Previews"} unavailable for ${missing.length} of ${slides.length} slides`}
    >
      <Anchor
        component="button"
        size="sm"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Hide affected slides" : "Show affected slides"}
      </Anchor>
      <Collapse expanded={expanded} id={detailsId}>
        <Text size="sm">
          {missing.length === 1 ? "Slide" : "Slides"} {formatSlideNumberRanges(missing)}
        </Text>
      </Collapse>
    </Alert>
  );
}

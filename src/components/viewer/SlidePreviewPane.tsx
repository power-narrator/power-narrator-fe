import { Image } from "@mantine/core";
import type { SlideNumber } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import { PreviewUnavailablePlaceholder } from "./PreviewUnavailablePlaceholder";

type SlidePreviewPaneProps = {
  preview: Slide["preview"];
  slideNumber: SlideNumber;
};

export function SlidePreviewPane({ preview, slideNumber }: SlidePreviewPaneProps) {
  if (!preview) {
    return (
      <PreviewUnavailablePlaceholder
        role="img"
        aria-label={`Slide ${slideNumber} preview unavailable`}
        h="100%"
      />
    );
  }

  return <Image src={preview.src} alt={`Slide ${slideNumber} preview`} fit="contain" h="100%" />;
}

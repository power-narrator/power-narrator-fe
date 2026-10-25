import { Box, Image } from "@mantine/core";
import type { SlideNumber } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import { PreviewUnavailablePlaceholder } from "./PreviewUnavailablePlaceholder";

type SlidePreviewPaneProps = {
  preview: Slide["preview"];
  slideNumber: SlideNumber;
};

export function SlidePreviewPane({ preview, slideNumber }: SlidePreviewPaneProps) {
  return (
    <Box component="section" aria-label="Slide preview" h="100%">
      {preview ? (
        <Image src={preview.src} alt={`Slide ${slideNumber} preview`} fit="contain" h="100%" />
      ) : (
        <PreviewUnavailablePlaceholder h="100%" />
      )}
    </Box>
  );
}

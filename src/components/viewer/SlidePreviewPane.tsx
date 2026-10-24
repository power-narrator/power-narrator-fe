import { Center, Image, Text } from "@mantine/core";
import type { SlideNumber } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";

type SlidePreviewPaneProps = {
  preview: Slide["preview"];
  slideNumber: SlideNumber;
};

export function SlidePreviewPane({ preview, slideNumber }: SlidePreviewPaneProps) {
  if (!preview) {
    return (
      <Center role="img" aria-label={`Slide ${slideNumber} preview unavailable`} h="100%">
        <Text c="dimmed">Preview unavailable</Text>
      </Center>
    );
  }

  return <Image src={preview.src} alt={`Slide ${slideNumber} preview`} fit="contain" h="100%" />;
}

import { Image } from "@mantine/core";
import type { SlideNumber } from "../../../shared/slides/slideCoordinates";

type SlidePreviewPaneProps = {
  activeSlideSrc: string;
  slideNumber: SlideNumber;
};

export function SlidePreviewPane({ activeSlideSrc, slideNumber }: SlidePreviewPaneProps) {
  return <Image src={activeSlideSrc} alt={`Slide ${slideNumber} preview`} fit="contain" h="100%" />;
}

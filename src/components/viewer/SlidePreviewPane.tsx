import { Image } from "@mantine/core";

interface SlidePreviewPaneProps {
  activeSlideSrc: string;
  slideNumber: number;
}

export function SlidePreviewPane({ activeSlideSrc, slideNumber }: SlidePreviewPaneProps) {
  return <Image src={activeSlideSrc} alt={`Slide ${slideNumber} preview`} fit="contain" h="100%" />;
}

import { Image } from "@mantine/core";

interface SlidePreviewPaneProps {
  activeSlideSrc: string;
}

export function SlidePreviewPane({ activeSlideSrc }: SlidePreviewPaneProps) {
  return (
    <Image src={activeSlideSrc} fit="contain" style={{ maxHeight: "100%", maxWidth: "100%" }} />
  );
}

import { Box, Image, ScrollArea, Stack } from "@mantine/core";
import type { Slide } from "../../types/electron";

interface SlideThumbnailListProps {
  slides: Slide[];
  activeSlideIndex: number;
  onSelectSlide: (index: number) => void;
}

export function SlideThumbnailList({
  slides,
  activeSlideIndex,
  onSelectSlide,
}: SlideThumbnailListProps) {
  return (
    <ScrollArea
      w="250"
      type="auto"
      style={{ borderRight: "1px solid var(--mantine-color-default-border)" }}
    >
      <Stack gap="xs" p="md">
        {slides.map((slide, index) => (
          <Box
            key={slide.index}
            onClick={() => onSelectSlide(index)}
            bdrs="xs"
            pos="relative"
            bd={activeSlideIndex === index ? "2 solid blue" : "2 solid transparent"}
            style={{
              cursor: "pointer",
            }}
          >
            <Box
              pos="absolute"
              top={4}
              left={4}
              bg="rgba(0,0,0,0.6)"
              p="2 6"
              bdrs="xs"
              fz="xs"
              style={{
                zIndex: 10,
              }}
            >
              {index + 1}
            </Box>
            <Image src={slide.src} radius="sm" />
          </Box>
        ))}
      </Stack>
    </ScrollArea>
  );
}

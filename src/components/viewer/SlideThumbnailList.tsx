import { Box, Image, ScrollArea, Stack, UnstyledButton } from "@mantine/core";
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
    <ScrollArea type="auto" h="100%">
      <Stack gap="xs" p="md">
        {slides.map((slide, index) => {
          const isActive = activeSlideIndex === index;

          return (
            <UnstyledButton
              key={slide.index}
              aria-label={`Slide ${index + 1}`}
              aria-current={isActive || undefined}
              onClick={() => onSelectSlide(index)}
              bdrs="sm"
              pos="relative"
              bd={isActive ? "6 solid blue" : "6 solid transparent"}
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
              <Image src={slide.src} alt="" radius={isActive ? "none" : "sm"} />
            </UnstyledButton>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}

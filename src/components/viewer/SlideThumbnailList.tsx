import { Box, Image, ScrollArea, Stack, UnstyledButton } from "@mantine/core";
import { slideNumberOf, type SlideIndex } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";

interface SlideThumbnailListProps {
  slides: readonly Pick<Slide, "slideIndex" | "src">[];
  activeSlideIndex: SlideIndex | undefined;
  onSelectSlide: (slideIndex: SlideIndex) => void;
}

export function SlideThumbnailList({
  slides,
  activeSlideIndex,
  onSelectSlide,
}: SlideThumbnailListProps) {
  return (
    <ScrollArea type="auto" h="100%">
      <Stack gap="xs" p="md">
        {slides.map((slide) => {
          const isActive = activeSlideIndex === slide.slideIndex;
          const slideNumber = slideNumberOf(slide.slideIndex);

          return (
            <UnstyledButton
              key={slide.slideIndex}
              aria-label={`Slide ${slideNumber}`}
              aria-current={isActive || undefined}
              onClick={() => onSelectSlide(slide.slideIndex)}
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
                {slideNumber}
              </Box>
              <Image src={slide.src} alt="" radius={isActive ? "none" : "sm"} />
            </UnstyledButton>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}

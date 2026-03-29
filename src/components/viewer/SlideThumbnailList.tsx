import { Box, Image, ScrollArea } from "@mantine/core";
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
    <div
      style={{
        width: "250px",
        height: "100%",
        borderRight: "1px solid var(--mantine-color-dark-4)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Box p="md">
          {slides.map((slide, index) => (
            <Box
              key={slide.index}
              onClick={() => onSelectSlide(index)}
              style={{
                marginBottom: "1rem",
                cursor: "pointer",
                border:
                  activeSlideIndex === index
                    ? "2px solid var(--mantine-color-blue-6)"
                    : "2px solid transparent",
                borderRadius: "4px",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  zIndex: 10,
                  background: "rgba(0,0,0,0.6)",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "10px",
                  fontWeight: "bold",
                  pointerEvents: "none",
                }}
              >
                {index + 1}
              </div>
              <Image src={slide.src} radius="sm" />
            </Box>
          ))}
        </Box>
      </ScrollArea>
    </div>
  );
}

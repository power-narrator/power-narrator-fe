import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { slideIndexFromLegacyNumber, toSlideNumber } from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import { SlideThumbnailList } from "./SlideThumbnailList";

const slides: Slide[] = [
  {
    slideIndex: slideIndexFromLegacyNumber(1),
    index: toSlideNumber(1),
    image: "one.png",
    src: "one.png",
    sections: [],
  },
  {
    slideIndex: slideIndexFromLegacyNumber(2),
    index: toSlideNumber(2),
    image: "two.png",
    src: "two.png",
    sections: [],
  },
];

async function renderThumbnails(activeSlideIndex = 0) {
  const onSelectSlide = vi.fn<(index: number) => void>();
  const screen = await render(
    <MantineProvider>
      <SlideThumbnailList
        slides={slides}
        activeSlideIndex={activeSlideIndex}
        onSelectSlide={onSelectSlide}
      />
    </MantineProvider>,
  );

  return { screen, onSelectSlide };
}

test("exposes each thumbnail as a button naming its slide", async () => {
  const { screen } = await renderThumbnails();

  await expect.element(screen.getByRole("button", { name: "Slide 1" })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Slide 2" })).toBeInTheDocument();
});

test("marks the active thumbnail as the current slide", async () => {
  const { screen } = await renderThumbnails(1);

  await expect
    .element(screen.getByRole("button", { name: "Slide 2" }))
    .toHaveAttribute("aria-current", "true");
  await expect
    .element(screen.getByRole("button", { name: "Slide 1" }))
    .not.toHaveAttribute("aria-current");
});

test("selects a slide when its thumbnail is activated from the keyboard", async () => {
  const { screen, onSelectSlide } = await renderThumbnails();

  await screen.getByRole("button", { name: "Slide 2" }).click();

  expect(onSelectSlide).toHaveBeenCalledWith(1);
});

import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  slideNumberOf,
  toSlideIndex,
  type SlideIndex,
} from "../../../shared/slides/slideCoordinates";
import type { Slide } from "../../types/electron";
import { SlideThumbnailList } from "./SlideThumbnailList";

const at = (zeroBased: number): SlideIndex => toSlideIndex(zeroBased);

const thumbnail = (slideIndex: SlideIndex): Slide => ({
  slideIndex,
  image: `${slideNumberOf(slideIndex)}.png`,
  src: `${slideNumberOf(slideIndex)}.png`,
  sections: [],
});

const slides: Slide[] = [thumbnail(at(0)), thumbnail(at(1))];

async function renderThumbnails(
  activeSlideIndex: SlideIndex | undefined,
  listed: readonly Slide[] = slides,
) {
  const onSelectSlide = vi.fn<(slideIndex: SlideIndex) => void>();
  const screen = await render(
    <MantineProvider>
      <SlideThumbnailList
        slides={listed}
        activeSlideIndex={activeSlideIndex}
        onSelectSlide={onSelectSlide}
      />
    </MantineProvider>,
  );

  return { screen, onSelectSlide };
}

test("exposes each thumbnail as a button naming its slide", async () => {
  const { screen } = await renderThumbnails(at(0));

  await expect.element(screen.getByRole("button", { name: "Slide 1" })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Slide 2" })).toBeInTheDocument();
});

test("marks the active thumbnail as the current slide", async () => {
  const { screen } = await renderThumbnails(at(1));

  await expect
    .element(screen.getByRole("button", { name: "Slide 2" }))
    .toHaveAttribute("aria-current", "true");
  await expect
    .element(screen.getByRole("button", { name: "Slide 1" }))
    .not.toHaveAttribute("aria-current");
});

test("selects a slide when its thumbnail is activated from the keyboard", async () => {
  const { screen, onSelectSlide } = await renderThumbnails(at(0));

  await screen.getByRole("button", { name: "Slide 2" }).click();

  expect(onSelectSlide).toHaveBeenCalledWith(at(1));
});

test("names and selects a slide by its own index, not its place in the list", async () => {
  const gapped = [thumbnail(at(0)), thumbnail(at(4))];
  const { screen, onSelectSlide } = await renderThumbnails(at(0), gapped);

  await expect.element(screen.getByRole("button", { name: "Slide 5" })).toBeInTheDocument();

  await screen.getByRole("button", { name: "Slide 5" }).click();

  expect(onSelectSlide).toHaveBeenCalledWith(at(4));
});

test("marks no thumbnail current when the presentation has no active slide", async () => {
  const { screen } = await renderThumbnails(undefined);

  await expect
    .element(screen.getByRole("button", { name: "Slide 1" }))
    .not.toHaveAttribute("aria-current");
});

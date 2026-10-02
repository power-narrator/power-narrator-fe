declare const slideIndexBrand: unique symbol;
declare const slideNumberBrand: unique symbol;

/**
 * The presentation-wide 0-based ordinal of a slide. Branded so a slide number
 * can never be passed where a slide index is expected, or the reverse.
 */
export type SlideIndex = number & { readonly [slideIndexBrand]: "slide index" };

export type SlideNumber = number & { readonly [slideNumberBrand]: "slide number" };

function assertOrdinal(value: number, minimum: number, what: string): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${value} is not a ${what}`);
  }
}

export function toSlideIndex(zeroBased: number): SlideIndex {
  assertOrdinal(zeroBased, 0, "slide index");
  return zeroBased as SlideIndex;
}

export function toSlideNumber(oneBased: number): SlideNumber {
  assertOrdinal(oneBased, 1, "slide number");
  return oneBased as SlideNumber;
}

export const slideNumberOf = (slideIndex: SlideIndex): SlideNumber =>
  (slideIndex + 1) as SlideNumber;

export const slideIndexOf = (slideNumber: SlideNumber): SlideIndex =>
  (slideNumber - 1) as SlideIndex;

/**
 * The entry point for a 1-based slide number arriving as a plain number from
 * outside the application, which keeps such a value from being read as a slide
 * index on the way in.
 */
export const slideIndexFromOneBased = (oneBased: number): SlideIndex =>
  slideIndexOf(toSlideNumber(oneBased));

export function trySlideIndexFromOneBased(oneBased: unknown): SlideIndex | undefined {
  return typeof oneBased === "number" && Number.isInteger(oneBased) && oneBased >= 1
    ? slideIndexFromOneBased(oneBased)
    : undefined;
}

export const FIRST_SLIDE_INDEX = toSlideIndex(0);

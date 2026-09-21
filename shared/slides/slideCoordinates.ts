declare const slideIndexBrand: unique symbol;
declare const slideNumberBrand: unique symbol;

/**
 * The presentation-wide 0-based ordinal of a slide. Branded so a slide number
 * can never be passed where a slide index is expected, or the reverse.
 */
export type SlideIndex = number & { readonly [slideIndexBrand]: "slide index" };

/** The author-facing 1-based ordinal derived from a slide index. */
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

export const slideNumberOf = (index: SlideIndex): SlideNumber => (index + 1) as SlideNumber;

export const slideIndexOf = (number: SlideNumber): SlideIndex => (number - 1) as SlideIndex;

/**
 * The compatibility seam for workflows still handing over the 1-based
 * representation as a plain number, which keeps such a value from being read
 * as a slide index on the way in.
 */
export const slideIndexFromLegacyNumber = (legacyOneBased: number): SlideIndex =>
  slideIndexOf(toSlideNumber(legacyOneBased));

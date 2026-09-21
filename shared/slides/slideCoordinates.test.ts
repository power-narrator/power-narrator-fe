import { describe, expect, it } from "vitest";
import {
  slideIndexFromOneBased,
  slideIndexOf,
  slideNumberOf,
  toSlideIndex,
  toSlideNumber,
  trySlideIndexFromOneBased,
} from "./slideCoordinates.js";

describe("slide coordinates", () => {
  it("derives the author-facing slide number from a slide index", () => {
    expect(slideNumberOf(toSlideIndex(0))).toBe(1);
    expect(slideNumberOf(toSlideIndex(7))).toBe(8);
  });

  it("derives a slide index from an author-facing slide number", () => {
    expect(slideIndexOf(toSlideNumber(1))).toBe(0);
    expect(slideIndexOf(toSlideNumber(8))).toBe(7);
  });

  it("round-trips a slide index through its slide number", () => {
    const slideIndex = toSlideIndex(4);

    expect(slideIndexOf(slideNumberOf(slideIndex))).toBe(slideIndex);
  });

  it("converts a 1-based number arriving from outside the application", () => {
    expect(slideIndexFromOneBased(3)).toBe(2);
  });

  it("reports an unvetted value that cannot be a slide number", () => {
    expect(trySlideIndexFromOneBased(4)).toBe(3);
    expect(trySlideIndexFromOneBased(0)).toBeUndefined();
    expect(trySlideIndexFromOneBased(1.5)).toBeUndefined();
    expect(trySlideIndexFromOneBased("2")).toBeUndefined();
    expect(trySlideIndexFromOneBased(Number.NaN)).toBeUndefined();
  });

  it("rejects values that cannot be the ordinal they claim to be", () => {
    expect(() => toSlideIndex(-1)).toThrow(RangeError);
    expect(() => toSlideIndex(1.5)).toThrow(RangeError);
    expect(() => toSlideNumber(0)).toThrow(RangeError);
    expect(() => slideIndexFromOneBased(0)).toThrow(RangeError);
  });
});

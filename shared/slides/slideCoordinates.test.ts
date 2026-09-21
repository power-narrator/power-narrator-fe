import { describe, expect, it } from "vitest";
import {
  slideIndexFromLegacyNumber,
  slideIndexOf,
  slideNumberOf,
  toSlideIndex,
  toSlideNumber,
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
    const index = toSlideIndex(4);

    expect(slideIndexOf(slideNumberOf(index))).toBe(index);
  });

  it("converts legacy 1-based values at the compatibility seam", () => {
    expect(slideIndexFromLegacyNumber(3)).toBe(2);
  });

  it("rejects values that cannot be the ordinal they claim to be", () => {
    expect(() => toSlideIndex(-1)).toThrow(RangeError);
    expect(() => toSlideIndex(1.5)).toThrow(RangeError);
    expect(() => toSlideNumber(0)).toThrow(RangeError);
    expect(() => slideIndexFromLegacyNumber(0)).toThrow(RangeError);
  });
});

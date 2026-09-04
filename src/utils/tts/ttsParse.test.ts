import { describe, expect, it } from "vitest";
import { parseTtsSegments } from "./ttsParse";

describe("parseTtsSegments", () => {
  it("leaves the voice undefined when no override or default mapping exists", () => {
    const [segment] = parseTtsSegments("Hello", {});

    expect(segment?.voice).toBeUndefined();
  });
});

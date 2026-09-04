import { describe, expect, it } from "vitest";
import { concatUint8Arrays } from "./audioUtils";

function createWav(payload: number[]): Uint8Array {
  const wav = new Uint8Array(44 + payload.length);
  const view = new DataView(wav.buffer);

  wav.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, wav.length - 8, true);
  wav.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  wav.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, payload.length, true);
  wav.set(payload, 44);

  return wav;
}

describe("concatUint8Arrays", () => {
  it("returns an empty array when there are no chunks", () => {
    expect(concatUint8Arrays([])).toEqual(new Uint8Array());
  });

  it("directly concatenates non-WAV chunks", () => {
    expect(concatUint8Arrays([new Uint8Array([1, 2]), new Uint8Array([3])])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("combines WAV data and updates the RIFF and data sizes", () => {
    const result = concatUint8Arrays([createWav([1, 2]), createWav([3, 4, 5])]);
    const view = new DataView(result.buffer);

    expect(result.slice(44)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(view.getUint32(4, true)).toBe(result.length - 8);
    expect(view.getUint32(40, true)).toBe(5);
  });
});

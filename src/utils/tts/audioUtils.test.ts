import { describe, expect, it } from "vitest";
import { concatUint8Arrays } from "./audioUtils";

const RIFF_HEADER_SIZE = 12;
const CHUNK_HEADER_SIZE = 8;
const RIFF_SIZE_ADJUSTMENT = 8;

interface TestChunk {
  id: string;
  payload: number[];
}

function writeId(bytes: Uint8Array, offset: number, id: string): void {
  bytes.set(new TextEncoder().encode(id), offset);
}

function createWav(payload: number[], additionalChunks: TestChunk[] = []): Uint8Array {
  const formatChunk: TestChunk = {
    id: "fmt ",
    payload: [1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0],
  };
  const chunks = [formatChunk, ...additionalChunks, { id: "data", payload }];
  const chunkBytesLength = chunks.reduce(
    (total, chunk) => total + CHUNK_HEADER_SIZE + chunk.payload.length + (chunk.payload.length % 2),
    0,
  );
  const wav = new Uint8Array(RIFF_HEADER_SIZE + chunkBytesLength);
  const view = new DataView(wav.buffer);

  writeId(wav, 0, "RIFF");
  view.setUint32(4, wav.length - RIFF_SIZE_ADJUSTMENT, true);
  writeId(wav, 8, "WAVE");

  let offset = RIFF_HEADER_SIZE;
  for (const chunk of chunks) {
    writeId(wav, offset, chunk.id);
    view.setUint32(offset + 4, chunk.payload.length, true);
    wav.set(chunk.payload, offset + CHUNK_HEADER_SIZE);
    offset += CHUNK_HEADER_SIZE + chunk.payload.length + (chunk.payload.length % 2);
  }

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

    expect(result.slice(44, 49)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result.length).toBe(50);
    expect(view.getUint32(4, true)).toBe(result.length - RIFF_SIZE_ADJUSTMENT);
    expect(view.getUint32(40, true)).toBe(5);
  });

  it("finds data after an odd-sized padded chunk", () => {
    const first = createWav([1], [{ id: "JUNK", payload: [9] }]);
    const result = concatUint8Arrays([first, createWav([2])]);
    const dataOffset = 54;
    const view = new DataView(result.buffer);

    expect(result.slice(dataOffset, dataOffset + 2)).toEqual(new Uint8Array([1, 2]));
    expect(view.getUint32(dataOffset - 4, true)).toBe(2);
  });

  it("rejects a RIFF chunk without a WAVE identifier", () => {
    const wav = createWav([1]);
    writeId(wav, 8, "AVI ");

    expect(() => concatUint8Arrays([wav])).toThrow("valid RIFF/WAVE header");
  });

  it("rejects a WAV chunk without a data chunk", () => {
    expect(() => concatUint8Arrays([createWav([1]).slice(0, 36)])).toThrow(
      "does not contain a data chunk",
    );
  });

  it("rejects a truncated WAV payload", () => {
    const wav = createWav([1, 2, 3]);

    expect(() => concatUint8Arrays([wav.slice(0, wav.length - 2)])).toThrow(
      "truncated chunk payload",
    );
  });

  it("rejects a non-WAV chunk mixed into WAV input", () => {
    expect(() => concatUint8Arrays([createWav([1]), new Uint8Array([1, 2, 3])])).toThrow(
      "truncated RIFF header",
    );
  });
});

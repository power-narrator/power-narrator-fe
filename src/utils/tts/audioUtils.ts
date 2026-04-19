/**
 * Concatenates multiple audio Uint8Arrays into a single contiguous buffer.
 * Supports both WAV and MP3 formats. For WAV formats, it parses the RIFF headers
 * and aggregates the data chunks to produce a valid combined WAV file.
 * For MP3 formats, it performs a direct binary concatenation.
 *
 * @param arrays - An array of Uint8Arrays representing individual audio chunks.
 * @returns A single Uint8Array containing the concatenated audio data.
 */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 0) return new Uint8Array(0);

  const isWav =
    arrays[0].length >= 44 &&
    arrays[0][0] === 0x52 &&
    arrays[0][1] === 0x49 &&
    arrays[0][2] === 0x46 &&
    arrays[0][3] === 0x46;

  if (isWav) {
    let totalDataLength = 0;
    const mapped = arrays.map((arr) => {
      let offset = 12;
      let dataOffset = 44;
      let dataLen = arr.length - 44;

      while (offset < arr.length - 8) {
        if (
          arr[offset] === 0x64 &&
          arr[offset + 1] === 0x61 &&
          arr[offset + 2] === 0x74 &&
          arr[offset + 3] === 0x61
        ) {
          dataLen =
            arr[offset + 4] |
            (arr[offset + 5] << 8) |
            (arr[offset + 6] << 16) |
            (arr[offset + 7] << 24);
          dataOffset = offset + 8;
          break;
        }
        const chunkLen =
          arr[offset + 4] |
          (arr[offset + 5] << 8) |
          (arr[offset + 6] << 16) |
          (arr[offset + 7] << 24);
        offset += 8 + chunkLen;
      }
      return { headerLen: dataOffset, dataLen: dataLen, arr };
    });

    totalDataLength = mapped.reduce((sum, item) => sum + item.dataLen, 0);

    const firstHeaderLen = mapped[0].headerLen;
    const out = new Uint8Array(firstHeaderLen + totalDataLength);

    out.set(mapped[0].arr.slice(0, firstHeaderLen), 0);

    const riffSize = firstHeaderLen + totalDataLength - 8;
    out[4] = riffSize & 0xff;
    out[5] = (riffSize >> 8) & 0xff;
    out[6] = (riffSize >> 16) & 0xff;
    out[7] = (riffSize >> 24) & 0xff;

    const dataChunkSizeOffset = firstHeaderLen - 4;
    out[dataChunkSizeOffset] = totalDataLength & 0xff;
    out[dataChunkSizeOffset + 1] = (totalDataLength >> 8) & 0xff;
    out[dataChunkSizeOffset + 2] = (totalDataLength >> 16) & 0xff;
    out[dataChunkSizeOffset + 3] = (totalDataLength >> 24) & 0xff;

    let currentOffset = firstHeaderLen;
    for (const m of mapped) {
      out.set(m.arr.slice(m.headerLen, m.headerLen + m.dataLen), currentOffset);
      currentOffset += m.dataLen;
    }

    return out;
  }

  const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

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
  const [firstArray] = arrays;
  if (!firstArray) return new Uint8Array(0);

  const isWav =
    firstArray.length >= 44 &&
    new DataView(firstArray.buffer, firstArray.byteOffset, firstArray.byteLength).getUint32(
      0,
      false,
    ) === 0x52494646;

  if (isWav) {
    const mapped = arrays.map((arr) => {
      const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      let chunkOffset = 12;
      let dataOffset = Math.min(44, arr.length);
      let dataLen = Math.max(0, arr.length - dataOffset);

      while (chunkOffset + 8 <= arr.length) {
        const chunkName = view.getUint32(chunkOffset, false);
        const chunkLen = view.getUint32(chunkOffset + 4, true);

        if (chunkName === 0x64617461) {
          dataOffset = chunkOffset + 8;
          dataLen = Math.min(chunkLen, arr.length - dataOffset);
          break;
        }

        chunkOffset += 8 + chunkLen;
      }

      return { headerLen: dataOffset, dataLen, arr };
    });

    const totalDataLength = mapped.reduce((sum, item) => sum + item.dataLen, 0);
    const [firstMapped] = mapped;
    if (!firstMapped) return new Uint8Array(0);

    const firstHeaderLen = firstMapped.headerLen;
    const out = new Uint8Array(firstHeaderLen + totalDataLength);

    out.set(firstMapped.arr.slice(0, firstHeaderLen), 0);

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

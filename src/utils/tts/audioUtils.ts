const RIFF_ID = 0x52494646;
const WAVE_ID = 0x57415645;
const DATA_ID = 0x64617461;

const RIFF_ID_OFFSET = 0;
const RIFF_SIZE_OFFSET = 4;
const WAVE_ID_OFFSET = 8;
const RIFF_HEADER_SIZE = 12;
const CHUNK_HEADER_SIZE = 8;
const CHUNK_SIZE_OFFSET = 4;
const RIFF_SIZE_ADJUSTMENT = 8;
const RIFF_CHUNK_ALIGNMENT = 2;
const FOUR_CC_LENGTH = 4;
const LITTLE_ENDIAN = true;

interface WavData {
  bytes: Uint8Array;
  dataOffset: number;
  dataLength: number;
  dataSizeOffset: number;
}

function readId(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function paddedChunkLength(length: number): number {
  return length + (length % RIFF_CHUNK_ALIGNMENT);
}

function parseWavData(bytes: Uint8Array, chunkIndex: number): WavData {
  const label = `WAV chunk ${chunkIndex + 1}`;
  if (bytes.length < RIFF_HEADER_SIZE) {
    throw new Error(`${label} has a truncated RIFF header.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readId(view, RIFF_ID_OFFSET) !== RIFF_ID || readId(view, WAVE_ID_OFFSET) !== WAVE_ID) {
    throw new Error(`${label} does not contain a valid RIFF/WAVE header.`);
  }

  let chunkOffset = RIFF_HEADER_SIZE;
  while (chunkOffset < bytes.length) {
    if (chunkOffset + CHUNK_HEADER_SIZE > bytes.length) {
      throw new Error(`${label} has a truncated chunk header.`);
    }

    const chunkId = readId(view, chunkOffset);
    const chunkLength = view.getUint32(chunkOffset + CHUNK_SIZE_OFFSET, LITTLE_ENDIAN);
    const dataOffset = chunkOffset + CHUNK_HEADER_SIZE;
    const dataEnd = dataOffset + chunkLength;

    if (dataEnd > bytes.length) {
      throw new Error(`${label} has a truncated chunk payload.`);
    }

    if (chunkId === DATA_ID) {
      return {
        bytes,
        dataOffset,
        dataLength: chunkLength,
        dataSizeOffset: chunkOffset + CHUNK_SIZE_OFFSET,
      };
    }

    const nextChunkOffset = dataOffset + paddedChunkLength(chunkLength);
    if (nextChunkOffset > bytes.length) {
      throw new Error(`${label} is missing chunk padding.`);
    }
    chunkOffset = nextChunkOffset;
  }

  throw new Error(`${label} does not contain a data chunk.`);
}

function directlyConcat(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, bytes) => sum + bytes.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const bytes of arrays) {
    result.set(bytes, offset);
    offset += bytes.length;
  }

  return result;
}

/**
 * Concatenates multiple audio Uint8Arrays into a single contiguous buffer.
 * Supports both WAV and MP3 formats. For WAV formats, it parses the RIFF headers
 * and aggregates the data chunks to produce a valid combined WAV file.
 * For MP3 formats, it performs a direct binary concatenation.
 *
 * @param arrays - An array of Uint8Arrays representing individual audio chunks.
 * @returns A single Uint8Array containing the concatenated audio data.
 * @throws If the first chunk is WAV but any input has malformed or truncated WAV data.
 */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const [firstArray] = arrays;
  if (!firstArray) {
    return new Uint8Array(0);
  }

  const firstIsRiff =
    firstArray.length >= FOUR_CC_LENGTH &&
    new DataView(firstArray.buffer, firstArray.byteOffset, firstArray.byteLength).getUint32(
      RIFF_ID_OFFSET,
      false,
    ) === RIFF_ID;

  if (!firstIsRiff) {
    return directlyConcat(arrays);
  }

  const firstWav = parseWavData(firstArray, 0);
  const wavChunks = [
    firstWav,
    ...arrays.slice(1).map((bytes, index) => parseWavData(bytes, index + 1)),
  ];

  const totalDataLength = wavChunks.reduce((sum, wav) => sum + wav.dataLength, 0);
  const outputPaddingLength = totalDataLength % RIFF_CHUNK_ALIGNMENT;
  const output = new Uint8Array(firstWav.dataOffset + totalDataLength + outputPaddingLength);

  output.set(firstWav.bytes.subarray(0, firstWav.dataOffset));

  const outputView = new DataView(output.buffer);
  outputView.setUint32(RIFF_SIZE_OFFSET, output.length - RIFF_SIZE_ADJUSTMENT, LITTLE_ENDIAN);
  outputView.setUint32(firstWav.dataSizeOffset, totalDataLength, LITTLE_ENDIAN);

  let outputOffset = firstWav.dataOffset;
  for (const wav of wavChunks) {
    output.set(wav.bytes.subarray(wav.dataOffset, wav.dataOffset + wav.dataLength), outputOffset);
    outputOffset += wav.dataLength;
  }

  return output;
}

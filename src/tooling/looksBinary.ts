/** Same cap as workspace indexing — tools and indexer stay aligned. */
export const MAX_TOOL_FILE_BYTES = 512_000;

/**
 * Rejects obvious binaries: NUL bytes or a high ratio of control characters
 * in the first chunk (catches extensionless executables and corrupt reads).
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const maxSample = 16_384;
  const sample = bytes.subarray(0, Math.min(bytes.length, maxSample));
  if (sample.length === 0) {
    return false;
  }

  let controlish = 0;
  for (const b of sample) {
    if (b === 0) {
      return true;
    }
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      controlish++;
    }
  }
  return controlish / sample.length > 0.3;
}

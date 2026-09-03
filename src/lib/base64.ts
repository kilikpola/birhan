/**
 * Base64 → bytes.
 *
 * expo-file-system hands back file contents as base64 text, and the only thing
 * worth doing with an APK's contents is hashing the bytes they represent. There
 * is no dependable `atob` across the Hermes/RN versions this app ships on, so
 * the decode is done here rather than assumed to exist on `global`.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = /*#__PURE__*/ (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Decodes standard base64 (with or without `=` padding) into the bytes it
 * encodes. Throws on any character outside the alphabet — a silent skip would
 * turn corrupted input into a plausible-looking but wrong byte string, which is
 * precisely the mistake a hash check exists to catch.
 */
export function base64ToBytes(input: string): Uint8Array {
  let end = input.length;
  while (end > 0 && input[end - 1] === '=') end--;

  // Every 4 base64 chars carry 3 bytes; a trailing 2 or 3 chars carry 1 or 2.
  const fullGroups = Math.floor(end / 4);
  const remainder = end - fullGroups * 4;
  if (remainder === 1) throw new Error('Invalid base64: orphaned trailing character.');
  const outLength = fullGroups * 3 + (remainder === 2 ? 1 : remainder === 3 ? 2 : 0);

  const out = new Uint8Array(outLength);
  let o = 0;
  let acc = 0;
  let accBits = 0;

  for (let i = 0; i < end; i++) {
    const v = LOOKUP[input.charCodeAt(i) & 0xff];
    if (v === 255) throw new Error('Invalid base64: unexpected character.');
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[o++] = (acc >> accBits) & 0xff;
    }
  }

  return out;
}

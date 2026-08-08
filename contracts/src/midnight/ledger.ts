// ledger.ts - ledger decoding and the pure-circuit helpers, with no
// filesystem or environment dependency, so a browser can import them without
// dragging in `compiled-contract.ts`'s Node-only default parameter.
//
// A browser needs three things from `compiled-contract.ts` - the ledger
// decoder and two pure-circuit helpers - and none of them touch a filesystem.
// What made them unreachable was a convenience on the descriptor next to them:
//
//     export function amparoContract(config: MidnightConfig = loadConfig(), ...)
//
// A default parameter still has to typecheck, so every consumer of the module
// inherited `node:path`, `node:url` and `process.env` whether or not it ever
// triggered that default. Importing the decoder pulled in the env reader.

import {
  ledger, pureCircuits, ResponseKind,
  type Ledger as AmparoLedger, type CaseResponse,
} from '../managed/amparo/contract/index.js';

export { ledger, pureCircuits, ResponseKind };
export type { AmparoLedger, CaseResponse };

/**
 * Public commitment of an authority secret.
 *
 * This delegates to the contract's own exported pure circuit rather than
 * recomputing the hash in TypeScript. That is not a style preference: the
 * circuit re-derives this value from the witness at proving time and compares it
 * against what the ledger holds, so a hand-written reimplementation that differs
 * in any detail - domain string, padding, hash - produces a commitment that can
 * never be satisfied, and the failure surfaces as a rejected proof rather than
 * as a mismatch anyone can read.
 */
export function authorityCommitment(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) {
    throw new Error(`authority secret must be 32 bytes long (got ${secret.length})`);
  }
  return pureCircuits.authorityDigest(secret);
}

/**
 * The nullifier a filing by `secret` against `caseCommitment` writes on chain.
 *
 * Same reasoning as `authorityCommitment`: the leaf the circuit checks is
 * derived by `filingNullifierOf` inside the proof, so the client has to look up
 * the leaf using that exact function. A reimplementation that differs in the
 * domain string produces a leaf that is not in the tree, and the lookup returns
 * undefined with nothing to point at the cause.
 */
export function filingNullifier(secret: Uint8Array, caseCommitment: Uint8Array): Uint8Array {
  if (secret.length !== 32) {
    throw new Error(`subject secret must be 32 bytes long (got ${secret.length})`);
  }
  if (caseCommitment.length !== 32) {
    throw new Error(`case commitment must be 32 bytes long (got ${caseCommitment.length})`);
  }
  return pureCircuits.filingNullifierOf(secret, caseCommitment);
}

/**
 * Width of the mandatory `grounds` field, in BYTES.
 *
 * Not in characters. The circuit's type is `Bytes<256>` and UTF-8 spends two
 * bytes on every accented letter, so Spanish prose fits roughly 230 characters
 * here, not 256. Anything that shows a counter has to count what this counts.
 */
export const GROUNDS_BYTES = 256;

/**
 * Encodes the mandatory grounds into the fixed width the circuit expects.
 *
 * Throws on overflow instead of truncating, and the distinction is the whole
 * point of the function. Truncating a UTF-8 string at a byte offset splits
 * whatever multi-byte character straddles it, and the two halves are not valid
 * UTF-8 - so the failure would not be "the text was shortened", it would be a
 * permanent, unrewritable ledger entry ending in a replacement character. This
 * is the last place that can still refuse.
 *
 * Also refuses text that is empty or only whitespace. The circuit rejects the
 * all-zero padding on its own, but it cannot tell a single space from grounds,
 * and a lone space would satisfy it while stating exactly as much as a blank.
 * Catching it here turns a failed proof into an error with something to read.
 */
export function encodeGrounds(text: string): Uint8Array {
  if (text.trim() === '') {
    throw new Error('grounds must not be empty');
  }
  const utf8 = new TextEncoder().encode(text);
  if (utf8.length > GROUNDS_BYTES) {
    throw new Error(
      `grounds must fit in ${GROUNDS_BYTES} bytes (got ${utf8.length} for ${text.length} characters)`,
    );
  }
  const padded = new Uint8Array(GROUNDS_BYTES);
  padded.set(utf8);
  return padded;
}

/**
 * Reads the grounds back out of a recorded response.
 *
 * The trailing zeros are padding the circuit compares against, not content, so
 * they are cut before decoding rather than after: a `TextDecoder` given 200
 * zero bytes returns 200 NUL characters, which render as nothing and compare as
 * something.
 */
export function decodeGrounds(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

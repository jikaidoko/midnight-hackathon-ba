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

import { ledger, pureCircuits, type Ledger as AmparoLedger } from '../managed/amparo/contract/index.js';

export { ledger, pureCircuits };
export type { AmparoLedger };

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

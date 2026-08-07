// compiled-contract.ts - binds the compiled contract to its witness
// implementations and to its on-disk zero-knowledge assets.
//
// This is the one module that imports from `src/managed/`, so everything else
// stays independent of the compiler output layout.
//
// The contract is not instantiated here. The contract layer expects a
// descriptor - the contract CLASS plus its witnesses plus the path to its
// compiled assets - and constructs it itself when it needs to run the
// constructor or a circuit. Passing an already-constructed instance fails deep
// inside the deploy, with `Cannot read properties of undefined (reading 'ctor')`
// and no mention of this file.
//
// `CompiledContract` is imported through the protocol package rather than from
// `@midnight-ntwrk/compact-js` directly. It is the same module, re-exported, but
// it is the copy the contract layer itself resolves - taking it from anywhere
// else risks pairing a descriptor with a consumer that came from a different
// copy of the package.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract, ledger, pureCircuits } from '../managed/case_admission/contract/index.js';
import { witnesses, type AuthorityPrivateState } from '../witnesses.js';
import { loadConfig, CONTRACT_NAME, type MidnightConfig } from './config.js';

export { ledger, pureCircuits };
export type { AuthorityPrivateState };

/** The contract descriptor: class, witnesses, and where its ZK assets live. */
export function amparoContract(config: MidnightConfig = loadConfig()) {
  return CompiledContract.make(CONTRACT_NAME, Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(config.contractDir),
  );
}

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

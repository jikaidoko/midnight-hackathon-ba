// filing-witnesses.ts — TypeScript implementation of the `witness` functions
// declared in filing_registry.compact.
//
// Witnesses run on the subject's own device. They are NOT verified by the proof:
// the circuit proves it executed correctly over whatever these returned, not
// that what they returned is true. That is why every claim in the contract is
// anchored in public state and these only ever supply the secret.
//
// Type mapping: `Bytes<32>` -> `Uint8Array` (32 bytes), `Uint<64>` -> `bigint`.

import type { Witnesses, Ledger } from './managed/filing_registry/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

type Ctx = WitnessContext<Ledger, SubjectPrivateState>;

/**
 * A reporter's private state. Lives only on their device (private-state
 * provider), never crosses to the chain.
 *
 * - `subjectSecret`: root of their custodial identity. Every nullifier this
 *   subject spends derives from it, which is what makes their filings
 *   unlinkable to each other while still being provably theirs.
 * - `filingCount`: how many filings they have accumulated. Backs the threshold
 *   credential.
 */
export interface SubjectPrivateState {
  readonly subjectSecret: Uint8Array; // 32B
  readonly filingCount: bigint;
}

export function createSubjectPrivateState(subjectSecret: Uint8Array): SubjectPrivateState {
  if (subjectSecret.length !== 32) {
    throw new Error(`subjectSecret must be 32 bytes (got ${subjectSecret.length})`);
  }
  return { subjectSecret, filingCount: 0n };
}

/**
 * Each witness receives the `WitnessContext` (private state + read-only public
 * ledger) and returns `[nextPrivateState, value]`.
 *
 * `bumpFilingCount` is the only one that advances the private state. The circuit
 * calls it last, after every assert has passed, so the stored count never runs
 * ahead of the nullifiers actually spent on-chain.
 */
export const witnesses: Witnesses<SubjectPrivateState> = {
  subjectSecret: (c: Ctx) => [c.privateState, c.privateState.subjectSecret],

  filingCount: (c: Ctx) => [c.privateState, c.privateState.filingCount],

  bumpFilingCount: (c: Ctx) => [
    { ...c.privateState, filingCount: c.privateState.filingCount + 1n },
    [],
  ],
};

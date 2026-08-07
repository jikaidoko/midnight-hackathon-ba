// filing-witnesses.ts — TypeScript implementation of the `witness` functions
// declared in filing_registry.compact.
//
// Witnesses run on the subject's own device and are NOT verified by the proof:
// the circuit proves it executed correctly over whatever these returned, not
// that what they returned is true. The contract is built around that: the
// credential circuit never takes the subject's word for a count. It requires
// Merkle paths into the public nullifier tree, which no witness can fabricate.
//
// Type mapping: `Bytes<32>` -> `Uint8Array` (32 bytes).

import type { Witnesses, Ledger } from './managed/filing_registry/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

type Ctx = WitnessContext<Ledger, SubjectPrivateState>;

/**
 * A reporter's private state. Lives only on their device (private-state
 * provider), never crosses to the chain.
 *
 * One field, deliberately. Every nullifier this subject spends derives from
 * `subjectSecret`, which is what makes their filings unlinkable to each other
 * while still being provably theirs. There is no private counter: a count the
 * subject stores is a count the subject can edit, so the credential reads the
 * public tree instead.
 */
export interface SubjectPrivateState {
  readonly subjectSecret: Uint8Array; // 32B
}

export function createSubjectPrivateState(subjectSecret: Uint8Array): SubjectPrivateState {
  if (subjectSecret.length !== 32) {
    throw new Error(`subjectSecret must be 32 bytes (got ${subjectSecret.length})`);
  }
  return { subjectSecret };
}

/**
 * Each witness receives the `WitnessContext` (private state + read-only public
 * ledger) and returns `[nextPrivateState, value]`. Nothing here mutates the
 * private state — there is nothing to mutate.
 */
export const witnesses: Witnesses<SubjectPrivateState> = {
  subjectSecret: (c: Ctx) => [c.privateState, c.privateState.subjectSecret],
};

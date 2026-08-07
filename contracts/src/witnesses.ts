// witnesses.ts - TypeScript implementation of the `witness` declared in
// case_admission.compact.
//
// In Midnight, witnesses are DECLARED in Compact (signature only) and
// IMPLEMENTED here: they read local private state, never on-chain, and feed the
// secret value into the circuit. The value appears neither on the chain nor in
// the proof, which is why proving is necessarily client-side.
//
// Type mapping: `Bytes<32>` -> 32-byte `Uint8Array`.

import type { Witnesses, Ledger } from './managed/case_admission/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

type Ctx = WitnessContext<Ledger, AuthorityPrivateState>;

/**
 * Private state of the operator who admits cases. Lives ONLY on the control
 * body's device (private state provider) and never crosses to the chain.
 *
 * - `authoritySecret`: preimage of the published `authorityCommitment`. It is
 *   the only credential that enables `admitCase`. Whoever holds it, admits.
 */
export interface AuthorityPrivateState {
  readonly authoritySecret: Uint8Array; // 32B
}

/**
 * Witness object handed to the generated contract's constructor. Each function
 * receives the `WitnessContext` (private state + read-only public ledger) and
 * returns `[privateState, secretValue]`. `admitCase` does not mutate private
 * state - admitting a case does not change the credential - so the same object
 * is returned. The `Witnesses<AuthorityPrivateState>` type binds this signature
 * to the compiled circuit: if the .compact changes, this stops typechecking.
 */
export const witnesses: Witnesses<AuthorityPrivateState> = {
  authoritySecret: (c: Ctx) => [c.privateState, c.privateState.authoritySecret],
};

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

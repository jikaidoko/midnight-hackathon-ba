// amparo-witnesses.ts - TypeScript implementation of the two `witness`
// functions declared in amparo.compact.
//
// Witnesses are DECLARED in Compact (signature only) and IMPLEMENTED here: they
// read local private state, never on-chain state, and feed the secret into the
// circuit. The value appears neither on the chain nor in the proof, which is why
// proving is necessarily client-side.
//
// Witnesses run on the caller's own device and are NOT verified by the proof:
// the circuit proves it executed correctly over whatever these returned, not
// that what they returned is true. The contract is built around that. The
// credential circuit never takes the caller's word for a count — it requires
// Merkle paths into the public nullifier tree, which no witness can fabricate.
//
// ── One contract, two roles, one witness object ──────────────────────────────
//
// Unifying the contracts means both witnesses live in one object, but the two
// roles do not live on one machine: an oversight authority holds
// `authoritySecret`, a reporter holds `subjectSecret`, and neither has the
// other. So both are OPTIONAL in the private state, and asking for one that is
// absent throws here, with a sentence naming the role.
//
// The alternative — returning zeroes for the missing one — is worse in a way
// worth spelling out. A zeroed `authoritySecret` produces a valid proof of a
// FALSE statement about a digest that will not match `authorityCommitment`, and
// the transaction dies inside the circuit with "Unrecognized authority", after
// the proof was generated. A zeroed `subjectSecret` is worse still: it is a
// perfectly usable identity that every caller shares, so filings made under it
// collide with each other and the reporter silently becomes "whoever forgot to
// set a secret". Failing before the proof, by name, is the cheap and honest
// option.
//
// Type mapping: `Bytes<32>` -> 32-byte `Uint8Array`.

import type { Witnesses, Ledger } from './managed/amparo/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * Private state of whoever is calling. Holds at most one of the two secrets in
 * practice: the authority admits, the reporter files, and nobody does both.
 *
 * There is deliberately NO private filing counter. A count the reporter stores
 * is a count the reporter can edit, so the credential reads the public tree
 * instead — see `proveRepeatFilings`.
 */
export interface AmparoPrivateState {
  /** Preimage of the published `authorityCommitment`. Whoever holds it, admits. */
  readonly authoritySecret?: Uint8Array; // 32B
  /** The reporter's credential. Every nullifier they spend derives from it. */
  readonly subjectSecret?: Uint8Array; // 32B
}

type Ctx = WitnessContext<Ledger, AmparoPrivateState>;

function require32(value: Uint8Array | undefined, role: string, field: string): Uint8Array {
  if (value === undefined) {
    throw new Error(
      `This circuit needs the ${role}'s secret, and the private state has no \`${field}\`. ` +
        `Only the ${role} can call it.`,
    );
  }
  if (value.length !== 32) {
    throw new Error(`${field} must be 32 bytes (got ${value.length})`);
  }
  return value;
}

export function createAuthorityState(authoritySecret: Uint8Array): AmparoPrivateState {
  return { authoritySecret: require32(authoritySecret, 'authority', 'authoritySecret') };
}

export function createSubjectState(subjectSecret: Uint8Array): AmparoPrivateState {
  return { subjectSecret: require32(subjectSecret, 'reporter', 'subjectSecret') };
}

/**
 * Each witness receives the `WitnessContext` (private state + read-only public
 * ledger) and returns `[nextPrivateState, value]`. Neither mutates the private
 * state: admitting a case does not change the authority's credential, and
 * filing does not change the reporter's.
 */
export const witnesses: Witnesses<AmparoPrivateState> = {
  authoritySecret: (c: Ctx) => [
    c.privateState,
    require32(c.privateState.authoritySecret, 'authority', 'authoritySecret'),
  ],
  subjectSecret: (c: Ctx) => [
    c.privateState,
    require32(c.privateState.subjectSecret, 'reporter', 'subjectSecret'),
  ],
};

export function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

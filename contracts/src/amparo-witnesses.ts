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
 * Private state of whoever is calling: an authority OR a reporter, never both.
 *
 * A UNION, not a record of two optional fields. Before the contracts merged,
 * the two roles had separate types in separate files and "a private state
 * holding both secrets" was irrepresentable. Merging them into one optional
 * record quietly gave that back, and a type that permits the thing it exists to
 * prevent has stopped being the guard. The union restores it: the compiler
 * rejects a state carrying both, and the runtime check below becomes a
 * narrowing rather than a presence test.
 *
 * There is deliberately NO private filing counter. A count the reporter stores
 * is a count the reporter can edit, so the credential reads the public tree
 * instead — see `proveRepeatFilings`.
 */
export type AmparoPrivateState =
  | {
      readonly role: 'authority';
      /** Preimage of the published `authorityCommitment`. Whoever holds it, admits. */
      readonly authoritySecret: Uint8Array; // 32B
    }
  | {
      readonly role: 'reporter';
      /** The reporter's credential. Every nullifier they spend derives from it. */
      readonly subjectSecret: Uint8Array; // 32B
    };

type Ctx = WitnessContext<Ledger, AmparoPrivateState>;

function require32(value: Uint8Array, field: string): Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${field} must be 32 bytes (got ${value.length})`);
  }
  return value;
}

export function createAuthorityState(authoritySecret: Uint8Array): AmparoPrivateState {
  return { role: 'authority', authoritySecret: require32(authoritySecret, 'authoritySecret') };
}

export function createSubjectState(subjectSecret: Uint8Array): AmparoPrivateState {
  return { role: 'reporter', subjectSecret: require32(subjectSecret, 'subjectSecret') };
}

function needAuthority(ps: AmparoPrivateState): Uint8Array {
  if (ps.role !== 'authority') {
    throw new Error(
      "This circuit needs the authority's secret, and this private state belongs to a " +
        'reporter. Only the authority can admit cases.',
    );
  }
  return ps.authoritySecret;
}

function needReporter(ps: AmparoPrivateState): Uint8Array {
  if (ps.role !== 'reporter') {
    throw new Error(
      "This circuit needs the reporter's secret, and this private state belongs to the " +
        'authority. Only a reporter can file or present a credential.',
    );
  }
  return ps.subjectSecret;
}

/**
 * Each witness receives the `WitnessContext` (private state + read-only public
 * ledger) and returns `[nextPrivateState, value]`. Neither mutates the private
 * state: admitting a case does not change the authority's credential, and
 * filing does not change the reporter's.
 */
export const witnesses: Witnesses<AmparoPrivateState> = {
  authoritySecret: (c: Ctx) => [c.privateState, needAuthority(c.privateState)],
  subjectSecret: (c: Ctx) => [c.privateState, needReporter(c.privateState)],
};

export function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

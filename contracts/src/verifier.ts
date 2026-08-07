// verifier.ts — defence in depth for proveRepeatFilings.
//
// The circuit proves: "I hold three distinct nullifiers derived from my secret,
// each with a Merkle path to root R, and R is a root this contract's nullifier
// tree actually had." That last clause is enforced in-circuit by `checkRoot`,
// so a caller cannot present paths into a tree of their own making.
//
// This function re-states the same check off-chain. It is NOT what makes the
// credential sound - the circuit is - and it must never become that again:
// a guarantee that lives only in the verifier holds only for verifiers that
// remember to run it. Keep it as a second, independent source, useful where a
// caller reads a stored proof without re-executing the circuit.

import type { Ledger } from './managed/amparo/contract/index.js';

export type MerkleDigest = { readonly field: bigint };

/**
 * Rejects a credential whose claimed root is not a root the chain ever had.
 * Historic roots are accepted on purpose: a proof built moments before someone
 * else filed is still honest.
 */
export function assertClaimedRootIsOnChain(l: Ledger, claimedRoot: MerkleDigest): void {
  if (!l.filingNullifierTree.checkRoot(claimedRoot)) {
    throw new Error(
      `Claimed root ${claimedRoot.field} is not a root of the on-chain nullifier tree. ` +
      'The presenter proved membership in a tree of their own making.',
    );
  }
}

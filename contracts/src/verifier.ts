// verifier.ts — the off-chain obligation that closes proveRepeatFilings.
//
// The circuit proves: "I hold three distinct nullifiers derived from my secret,
// and each has a Merkle path to root R." It CANNOT prove that R is a real root
// of the on-chain tree: root() is runtime-only, so no circuit can bind a
// declared root to the ledger. Left alone, a caller could build their own tree
// and present paths into it — test 8 does exactly that, and the circuit accepts.
//
// So binding R to the chain is the verifier's job, and it is one call. A
// verifier that skips it is not verifying anything. Same guard shape as
// assertMirrorMatchesTree in case-registry.ts.

import type { Ledger } from './managed/filing_registry/contract/index.js';

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

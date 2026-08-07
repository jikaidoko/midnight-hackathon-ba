// case-registry.ts - OFF-CHAIN mirror of the admitted-case registry.
//
// It exists because of a hard language constraint: the MerkleTree ADT's `root()`
// is runtime-only and cannot be invoked in-circuit (verified against compactc
// 0.31.0). Since `admitCase` has to publish the new root into the `admittedRoot`
// mirror field, something has to compute that root BEFORE calling the circuit.
// That something is this module.
//
// KEY POINT: the tree is built with `StateBoundedMerkleTree`, the SAME
// implementation backing the standard library's `HistoricMerkleTree` ADT.
// Hand-rolling the hashing would produce a root that never matches;
// `assertMirrorMatchesTree` catches that against the real tree, and the tests
// exercise it in both directions.

import {
  StateBoundedMerkleTree,
  CompactTypeBytes,
  CompactTypeMerkleTreeDigest,
  type AlignedValue,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './managed/case_admission/contract/index.js';

/** Tree depth - MUST match `HistoricMerkleTree<20, ...>` in the circuit. */
export const TREE_DEPTH = 20;

const LEAF_T = new CompactTypeBytes(32);

/** Merkle digest in the shape the constructor and `admitCase` expect. */
export type MerkleDigest = { readonly field: bigint };

/**
 * Insertion mirror of the registry. Replicates the contract's admission order
 * (index = order of `admitCase` calls) so the resulting root can be anticipated.
 */
export interface CaseRegistry {
  /** Current mirror root. Before the first admission, the empty-tree root. */
  root(): MerkleDigest;
  /** Number of cases admitted into the mirror. */
  size(): number;
  /**
   * Inserts the commitment and returns the RESULTING root, which is what must be
   * passed to `admitCase` as `newRoot`. Throws if the case was already present,
   * mirroring the circuit's `assert(!admittedIndex.member(...))` so the mirror
   * does not drift when the transaction is going to fail anyway.
   */
  admit(caseCommitment: Uint8Array): MerkleDigest;
}

export function createCaseRegistry(): CaseRegistry {
  let tree = new StateBoundedMerkleTree(TREE_DEPTH).rehash();
  const leaves: Uint8Array[] = [];

  const currentRoot = (): MerkleDigest => {
    const rootAv = tree.root();
    if (!rootAv) {
      throw new Error('Undefined root after rehash: the mirror cannot anticipate the root');
    }
    return CompactTypeMerkleTreeDigest.fromValue(rootAv.value) as MerkleDigest;
  };

  return {
    root: currentRoot,
    size: () => leaves.length,
    admit(caseCommitment: Uint8Array): MerkleDigest {
      assertLen32(caseCommitment, 'caseCommitment');
      if (leaves.some((l) => bytesEqual(l, caseCommitment))) {
        throw new Error(`Case already admitted in the mirror: ${toHex(caseCommitment)}`);
      }
      const index = BigInt(leaves.length);
      leaves.push(Uint8Array.from(caseCommitment));
      tree = tree.update(index, leafAligned(caseCommitment)).rehash();
      return currentRoot();
    },
  };
}

/**
 * SECOND SOURCE, and the reason the `newRoot` hole does not bite silently.
 *
 * `admitCase` cannot bind its `newRoot` parameter to the real tree, because
 * `root()` is runtime-only. So an off-chain computation error would publish a
 * lying mirror without anything failing: the ledger would look healthy and the
 * symptom would surface much later, in the UI, far from the cause.
 *
 * This compares the mirror against the ledger's REAL tree - two independent
 * sources - and fails on evidence of contradiction. Run it after EVERY
 * admission, not at the end of a batch: what matters is the moment it drifts.
 */
export function assertMirrorMatchesTree(l: Ledger): void {
  const real = l.admittedCases.root().field;
  const mirror = l.admittedRoot.field;
  if (real !== mirror) {
    throw new Error(
      `Mirror drift: admittedRoot=${mirror} != real tree root=${real}. ` +
      'The root published by the authority does not match the on-chain registry.',
    );
  }
}

function leafAligned(leaf: Uint8Array): AlignedValue {
  return { value: LEAF_T.toValue(leaf), alignment: LEAF_T.alignment() };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function assertLen32(b: Uint8Array, name: string): void {
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes long (got ${b.length})`);
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

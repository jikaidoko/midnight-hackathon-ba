// admitted-paths.ts — off-chain mirror of the admitted-case registry, used to
// produce the Merkle paths that `registerFiling` consumes.
//
// A subject filing a report has to supply a path proving their case is in the
// admitted registry. That path is built client-side, off-chain, from a mirror of
// the on-chain tree — which is exactly why the circuit cannot trust it and
// re-derives the root instead.
//
// Step 1 of the filing registry mocks `admittedRoot`, so this mirror also plays
// the role of the authority: `admit()` seeds a case and returns the root the
// contract should be deployed with. At integration this shrinks to a read-only
// mirror of `case_admission`'s real tree.

import {
  StateBoundedMerkleTree,
  CompactTypeBytes,
  CompactTypeMerkleTreeDigest,
  CompactTypeMerkleTreePath,
  type AlignedValue,
} from '@midnight-ntwrk/compact-runtime';

/** Must match `MerkleTreePath<20, Bytes<32>>` in filing_registry.compact. */
export const TREE_DEPTH = 20;

const LEAF_T = new CompactTypeBytes(32);
const PATH_T = new CompactTypeMerkleTreePath(TREE_DEPTH, LEAF_T);

export type MerkleDigest = { readonly field: bigint };

/** Shape the generated circuit expects for a `MerkleTreePath<20, Bytes<32>>`. */
export type AdmittedPath = {
  leaf: Uint8Array;
  path: { sibling: MerkleDigest; goes_left: boolean }[];
};

export interface AdmittedRegistry {
  /** Current root — what the contract is deployed with in step 1. */
  root(): MerkleDigest;
  /** Adds a case to the registry and returns the resulting root. */
  admit(caseCommitment: Uint8Array): MerkleDigest;
  /** Membership path for an admitted case. Throws if it was never admitted. */
  pathFor(caseCommitment: Uint8Array): AdmittedPath;
  size(): number;
}

export function createAdmittedRegistry(): AdmittedRegistry {
  let tree = new StateBoundedMerkleTree(TREE_DEPTH).rehash();
  const leaves: Uint8Array[] = [];

  const currentRoot = (): MerkleDigest => {
    const rootAv = tree.root();
    if (!rootAv) throw new Error('Root undefined after rehash');
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

    pathFor(caseCommitment: Uint8Array): AdmittedPath {
      assertLen32(caseCommitment, 'caseCommitment');
      const index = leaves.findIndex((l) => bytesEqual(l, caseCommitment));
      if (index < 0) throw new Error(`Case not admitted: ${toHex(caseCommitment)}`);
      const av = tree.pathForLeaf(BigInt(index), leafAligned(caseCommitment));
      return PATH_T.fromValue(av.value) as AdmittedPath;
    },
  };
}

function leafAligned(leaf: Uint8Array): AlignedValue {
  return { value: LEAF_T.toValue(leaf), alignment: LEAF_T.alignment() };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function assertLen32(b: Uint8Array, name: string): void {
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes (got ${b.length})`);
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

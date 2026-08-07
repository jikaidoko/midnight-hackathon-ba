// merkle-mirror.ts — off-chain mirror of an on-chain Merkle tree of Bytes<32>
// leaves, used to build the membership paths that circuits consume.
//
// Two trees in this contract need one: the admitted-case registry and the
// filing-nullifier tree. Same shape, same depth, so one factory serves both
// rather than a copy per tree.
//
// ⚠️ A mirror is only as good as its ordering. Paths are valid only if the
// mirror inserted the same leaves in the same order the chain did. Rebuild it
// by replaying chain events, never by guessing — and if an on-chain insert
// fails, the mirror must not advance, or every later path is wrong.

import {
  StateBoundedMerkleTree,
  CompactTypeBytes,
  CompactTypeMerkleTreeDigest,
  CompactTypeMerkleTreePath,
  type AlignedValue,
} from '@midnight-ntwrk/compact-runtime';

/** Must match the `<20, Bytes<32>>` of the trees in amparo.compact. */
export const TREE_DEPTH = 20;

const LEAF_T = new CompactTypeBytes(32);
const PATH_T = new CompactTypeMerkleTreePath(TREE_DEPTH, LEAF_T);

export type MerkleDigest = { readonly field: bigint };

/** Shape the generated circuits expect for a `MerkleTreePath<20, Bytes<32>>`. */
export type LeafPath = {
  leaf: Uint8Array;
  path: { sibling: MerkleDigest; goes_left: boolean }[];
};

export interface MerkleMirror {
  /** Current root. */
  root(): MerkleDigest;
  /** Appends a leaf and returns the resulting root. */
  insert(leaf: Uint8Array): MerkleDigest;
  /** Membership path for a leaf. Throws if it was never inserted. */
  pathFor(leaf: Uint8Array): LeafPath;
  has(leaf: Uint8Array): boolean;
  size(): number;
}

export function createMerkleMirror(): MerkleMirror {
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
    has: (leaf) => leaves.some((l) => bytesEqual(l, leaf)),

    insert(leaf: Uint8Array): MerkleDigest {
      assertLen32(leaf, 'leaf');
      if (leaves.some((l) => bytesEqual(l, leaf))) {
        throw new Error(`Leaf already in the mirror: ${toHex(leaf)}`);
      }
      const index = BigInt(leaves.length);
      leaves.push(Uint8Array.from(leaf));
      tree = tree.update(index, aligned(leaf)).rehash();
      return currentRoot();
    },

    pathFor(leaf: Uint8Array): LeafPath {
      assertLen32(leaf, 'leaf');
      const index = leaves.findIndex((l) => bytesEqual(l, leaf));
      if (index < 0) throw new Error(`Leaf not in the mirror: ${toHex(leaf)}`);
      const av = tree.pathForLeaf(BigInt(index), aligned(leaf));
      return PATH_T.fromValue(av.value) as LeafPath;
    },
  };
}

function aligned(leaf: Uint8Array): AlignedValue {
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

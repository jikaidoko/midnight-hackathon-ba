// case_admission.test.ts - tests for the admission primitive on the Compact
// runtime SIMULATOR. Deploy-free and prover-free: it runs the circuit logic
// (asserts, state transitions) deterministically, WITHOUT generating a ZK proof
// or touching testnet, DUST or the proof server. This is the fast loop and the
// QA gate before the proof server enters the picture.
//
// Run: `npm test` (tsx resolves the .js -> .ts imports of the generated code;
// plain `node --test` does not).
//
// Coverage, and why each case exists:
//   1. Initial state + round-trip of the authority commitment.
//   2. Happy path of `admitCase`.
//   3. Authority gate: a secret that is not the committed one cannot admit.
//   4. Dedup: the same case cannot enter twice.
//   5. HISTORIC GUARANTEE - the reason the ledger is a HistoricMerkleTree and
//      not a MerkleTree. Without this case, the ADT choice is unexercised.
//   6. MIRROR GUARD - `newRoot` is unconstrained in-circuit; this case proves,
//      in both directions, that the off-chain second source catches it.
//   7. The authority secret never appears in public state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from './managed/case_admission/contract/index.js';
import { witnesses, bytesToHex, type AuthorityPrivateState } from './witnesses.js';
import {
  createCaseRegistry,
  assertMirrorMatchesTree,
  type MerkleDigest,
} from './case-registry.js';

const COIN_PK = '00'.repeat(32);
const b32 = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

// Credential of the admitting authority (the control body), and an impostor.
const AUTHORITY_SECRET = b32(0xa0);
const IMPOSTOR_SECRET = b32(0xb0);

// Case commitments: opaque, built off-chain by the control body from the case
// file. The contract learns nothing about the case beyond this value.
const CASE_A = b32(0x11);
const CASE_B = b32(0x22);
const CASE_C = b32(0x33);

type LedgerState = CircuitContext<AuthorityPrivateState>['currentQueryContext']['state'];

/** Freshly deployed contract, with its off-chain mirror synced at genesis. */
function setup() {
  const registry = createCaseRegistry();
  const genesisRoot = registry.root();
  const authorityCommitment = pureCircuits.authorityDigest(AUTHORITY_SECRET);

  const contract = new Contract<AuthorityPrivateState>(witnesses);
  const init = contract.initialState(
    createConstructorContext<AuthorityPrivateState>({ authoritySecret: AUTHORITY_SECRET }, COIN_PK),
    authorityCommitment,
    genesisRoot,
  );

  return {
    contract,
    registry,
    authorityCommitment,
    addr: dummyContractAddress(),
    state: init.currentContractState.data as LedgerState,
  };
}
type Ctx = ReturnType<typeof setup>;

/**
 * Runs `admitCase` with the given secret and returns the resulting state.
 * `newRoot` can be forced to simulate a lying mirror (case 6); by default it
 * comes from the mirror, which is the real path.
 */
function admit(
  c: Ctx,
  state: LedgerState,
  caseCommitment: Uint8Array,
  opts: { secret?: Uint8Array; newRoot?: MerkleDigest } = {},
): LedgerState {
  const newRoot = opts.newRoot ?? c.registry.admit(caseCommitment);
  const ctx = createCircuitContext<AuthorityPrivateState>(
    c.addr,
    COIN_PK,
    state,
    { authoritySecret: opts.secret ?? AUTHORITY_SECRET },
  );
  return c.contract.circuits.admitCase(ctx, caseCommitment, newRoot).context.currentQueryContext.state;
}

test('1. initial state: mirror aligned with the empty tree, authority committed', () => {
  const c = setup();
  const l = ledger(c.state);

  assert.equal(l.admittedCount, 0n, 'no case admitted yet');
  assert.equal(l.admittedIndex.size(), 0n, 'empty index');
  assert.equal(
    bytesToHex(l.authorityCommitment),
    bytesToHex(c.authorityCommitment),
    'the on-chain commitment is the one pureCircuits.authorityDigest computed',
  );
  // Hashing round-trip: the TS side and the circuit agree byte for byte.
  assert.equal(
    bytesToHex(pureCircuits.authorityDigest(AUTHORITY_SECRET)),
    bytesToHex(l.authorityCommitment),
  );
  assertMirrorMatchesTree(l);
});

test('2. admitCase: the case enters the registry and the public aggregate reflects it', () => {
  const c = setup();
  const s = admit(c, c.state, CASE_A);
  const l = ledger(s);

  assert.equal(l.admittedCount, 1n, 'one case admitted');
  assert.ok(l.admittedIndex.member(CASE_A), 'CASE_A is in the index');
  assert.ok(!l.admittedIndex.member(CASE_B), 'CASE_B was not admitted');
  assert.equal(l.admittedCases.firstFree(), 1n, 'one occupied leaf in the tree');
  assert.ok(l.admittedCases.findPathForLeaf(CASE_A), 'there is an inclusion path for CASE_A');
  assertMirrorMatchesTree(l);

  // Two more cases: the registry grows and the mirror stays aligned at each step.
  const s2 = admit(c, s, CASE_B);
  assertMirrorMatchesTree(ledger(s2));
  const s3 = admit(c, s2, CASE_C);
  assert.equal(ledger(s3).admittedCount, 3n);
  assertMirrorMatchesTree(ledger(s3));
});

test('3. authority gate: a secret that is not the committed one cannot admit', () => {
  const c = setup();

  assert.throws(
    () => admit(c, c.state, CASE_A, { secret: IMPOSTOR_SECRET, newRoot: c.registry.root() }),
    /Unrecognized authority/,
    'the impostor cannot admit cases',
  );

  // And the registry is untouched: the rejection left no half-written state.
  assert.equal(ledger(c.state).admittedCount, 0n);
});

test('4. dedup: the same case cannot enter the registry twice', () => {
  const c = setup();
  const s = admit(c, c.state, CASE_A);

  assert.throws(
    () => admit(c, s, CASE_A, { newRoot: c.registry.root() }),
    /Case already admitted/,
    'the second admission of the same commitment is rejected in-circuit',
  );
  assert.equal(ledger(s).admittedCount, 1n, 'the counter did not move');
});

test('5. HISTORIC GUARANTEE: an old root is still accepted after later admissions', () => {
  const c = setup();

  // CASE_A is admitted and someone takes the root as of that moment (they would
  // carry it to file a report later).
  const s1 = admit(c, c.state, CASE_A);
  const rootAtA = ledger(s1).admittedCases.root();
  assert.ok(ledger(s1).admittedCases.checkRoot(rootAtA), 'the current root is accepted, obviously');

  // A new case comes in. With a plain MerkleTree this would invalidate the root
  // above and serialize everyone about to file against CASE_A.
  const s2 = admit(c, s1, CASE_B);
  const l2 = ledger(s2);

  assert.notEqual(l2.admittedCases.root().field, rootAtA.field, 'the root did change');
  assert.ok(
    l2.admittedCases.checkRoot(rootAtA),
    'THIS is the guarantee: the previous root is still accepted, so old paths do not break',
  );
  assert.ok(l2.admittedCases.findPathForLeaf(CASE_A), 'CASE_A still has a path');

  // And the mirror is NOT a source of truth: it holds the new root, not the old
  // one. Verifying against `admittedRoot` would reintroduce the exact problem
  // the historic ADT solves.
  assert.equal(l2.admittedRoot.field, l2.admittedCases.root().field);
  assert.notEqual(l2.admittedRoot.field, rootAtA.field);
});

test('6. MIRROR GUARD: newRoot is unconstrained in-circuit, the second source catches it', () => {
  const c = setup();

  // Direction 1 - with the correct root the guard does NOT fire. Without this, a
  // guard that always fails would pass for a working one.
  const ok = admit(c, c.state, CASE_A);
  assert.doesNotThrow(() => assertMirrorMatchesTree(ledger(ok)));

  // Direction 2 - lying root. The circuit ACCEPTS it: this is the known hole,
  // `root()` is runtime-only and there is no way to bind the parameter to the
  // real tree.
  const c2 = setup();
  const lying: MerkleDigest = { field: 123456789n };
  const bad = admit(c2, c2.state, CASE_A, { newRoot: lying });

  assert.equal(ledger(bad).admittedCount, 1n, 'the circuit passed: the hole exists and is documented');
  assert.equal(ledger(bad).admittedRoot.field, lying.field, 'the mirror kept the false root');
  assert.throws(
    () => assertMirrorMatchesTree(ledger(bad)),
    /Mirror drift/,
    'comparing against the real tree is what closes the hole',
  );
});

test('7. the authority secret never appears in public state', () => {
  const c = setup();
  const l = ledger(admit(c, c.state, CASE_A));
  const secretHex = bytesToHex(AUTHORITY_SECRET);

  assert.notEqual(bytesToHex(l.authorityCommitment), secretHex, 'what is published is the digest');
  for (const leaf of l.admittedIndex) {
    assert.notEqual(bytesToHex(leaf), secretHex, 'the secret did not leak into the index');
  }
});

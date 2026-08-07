// filing_registry.test.ts — the filing registry, in the Compact runtime
// SIMULATOR. Deploy-free and prover-free: it runs circuit logic (asserts, state
// transitions) deterministically, without generating a ZK proof or touching
// testnet, DUST or a proof server.
//
// Run: `npm test` (tsx resolves the .js -> .ts imports of the generated code;
// plain `node --test` does not).
//
// Coverage, and why each case exists:
//   1. Initial state.
//   2. Happy path: a filing against an admitted case.
//   3. ADVERSARIAL — a path for a case that was never admitted is rejected.
//   4. A path whose leaf disagrees with the claimed case is rejected.
//   5. The same subject cannot file twice for the same case.
//   6. Nullifiers are bound to the PAIR, so different subjects may file the
//      same case. This is the mechanism, NOT Sybil resistance — see 13.
//   7. Credential happy path: three real filings produce a valid proof.
//   8. ADVERSARIAL — the central claim. Zero filings cannot produce a
//      credential, whatever the private state says.
//   9. ADVERSARIAL — one filing cannot be presented three times.
//  10. ADVERSARIAL — you cannot present another subject's filings.
//  11. A rejected presentation does not burn the verifier context.
//  12. Public per-case counter and the under-review flag.
//  13. KNOWN LIMITATION, asserted so it cannot rot silently into a claim we do
//      not have: output B counts distinct SECRETS, not distinct PEOPLE.
//  14. The subject secret never appears in public state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from './managed/filing_registry/contract/index.js';
import {
  witnesses,
  createSubjectPrivateState,
  type SubjectPrivateState,
} from './filing-witnesses.js';
import { createMerkleMirror, toHex, type LeafPath, type MerkleDigest } from './merkle-mirror.js';
import { assertClaimedRootIsOnChain } from './verifier.js';

const COIN_PK = '00'.repeat(32);
const b32 = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

const SOFIA = b32(0x50);
const OTHER = b32(0x60);
const THIRD = b32(0x70);

const CASE_A = b32(0x11);
const CASE_B = b32(0x22);
const CASE_C = b32(0x33);
const NEVER_ADMITTED = b32(0x99);

const VERIFIER = b32(0x01);
const OTHER_VERIFIER = b32(0x02);

type LedgerState = CircuitContext<SubjectPrivateState>['currentQueryContext']['state'];

/**
 * A deployed contract plus two off-chain mirrors: the admitted-case registry,
 * whose root the contract is deployed with, and the nullifier tree, which the
 * client rebuilds as filings land so it can produce credential paths.
 */
function setup(admitted: Uint8Array[] = [CASE_A, CASE_B, CASE_C], reviewThreshold = 3n) {
  const cases = createMerkleMirror();
  for (const c of admitted) cases.insert(c);

  const contract = new Contract<SubjectPrivateState>(witnesses);
  const init = contract.initialState(
    createConstructorContext<SubjectPrivateState>(createSubjectPrivateState(SOFIA), COIN_PK),
    cases.root(),
    reviewThreshold,
  );

  return {
    contract,
    cases,
    addr: dummyContractAddress(),
    state: init.currentContractState.data as LedgerState,
  };
}

type Env = ReturnType<typeof setup>;

/**
 * Runs `registerFiling` and advances the nullifier mirror in lockstep — only
 * after the on-chain call succeeded, so a rejected filing never desynchronises
 * the mirror.
 */
function file(
  e: Env, state: LedgerState, secret: Uint8Array, kase: Uint8Array, path?: LeafPath,
): LedgerState {
  const ctx = createCircuitContext<SubjectPrivateState>(
    e.addr, COIN_PK, state, createSubjectPrivateState(secret),
  );
  const out = e.contract.circuits.registerFiling(ctx, kase, path ?? e.cases.pathFor(kase));
  return out.context.currentQueryContext.state;
}

/** Runs `proveRepeatFilings` with paths taken from the nullifier mirror. */
function present(
  e: Env,
  state: LedgerState,
  secret: Uint8Array,
  cases: [Uint8Array, Uint8Array, Uint8Array],
  verifier: Uint8Array,
  opts: { paths?: LeafPath[]; root?: MerkleDigest } = {},
): { result: boolean; state: LedgerState } {
  const tree = ledger(state).filingNullifierTree;
  const paths = opts.paths ?? cases.map((c) => {
    const leaf = pureCircuits.filingNullifierOf(secret, c);
    const p = tree.findPathForLeaf(leaf);
    if (!p) throw new Error(`no filing on record for this leaf: ${toHex(leaf)}`);
    return p as unknown as LeafPath;
  });
  const ctx = createCircuitContext<SubjectPrivateState>(
    e.addr, COIN_PK, state, createSubjectPrivateState(secret),
  );
  const out = e.contract.circuits.proveRepeatFilings(
    ctx, cases, paths as never, opts.root ?? tree.root(), verifier,
  );
  return { result: out.result, state: out.context.currentQueryContext.state };
}

/** Three real filings by one subject. */
function threeFilings(e: Env): LedgerState {
  let s = e.state;
  for (const c of [CASE_A, CASE_B, CASE_C]) s = file(e, s, SOFIA, c);
  return s;
}

test('1. initial state is empty', () => {
  const e = setup();
  const l = ledger(e.state);
  assert.equal(l.spentFilingNullifiers.size(), 0n);
  assert.equal(l.spentPresentationNullifiers.size(), 0n);
  assert.equal(l.admittedRoot.field, e.cases.root().field);
});

test('2. happy path: a filing against an admitted case is accepted', () => {
  const e = setup();
  const s = file(e, e.state, SOFIA, CASE_A);
  assert.equal(ledger(s).spentFilingNullifiers.size(), 1n);
});

test('3. ADVERSARIAL: a path for a case that was never admitted is rejected', () => {
  const e = setup();
  const rogue = createMerkleMirror();
  rogue.insert(NEVER_ADMITTED);
  assert.throws(
    () => file(e, e.state, SOFIA, NEVER_ADMITTED, rogue.pathFor(NEVER_ADMITTED)),
    /not in the admitted registry/i,
  );
});

test('4. a path whose leaf disagrees with the claimed case is rejected', () => {
  const e = setup();
  assert.throws(
    () => file(e, e.state, SOFIA, CASE_A, e.cases.pathFor(CASE_B)),
    /leaf does not match/i,
  );
});

test('5. the same subject cannot file twice for the same case', () => {
  const e = setup();
  const s = file(e, e.state, SOFIA, CASE_A);
  assert.throws(() => file(e, s, SOFIA, CASE_A), /already filed/i);
});

test('6. nullifiers are bound to the (subject, case) pair', () => {
  const e = setup();
  let s = file(e, e.state, SOFIA, CASE_A);
  s = file(e, s, OTHER, CASE_A);
  assert.equal(ledger(s).spentFilingNullifiers.size(), 2n);
});

test('7. credential: three real filings produce a valid proof', () => {
  const e = setup();
  const s = threeFilings(e);
  const out = present(e, s, SOFIA, [CASE_A, CASE_B, CASE_C], VERIFIER);
  assert.equal(out.result, true);
  assert.equal(ledger(out.state).spentPresentationNullifiers.size(), 1n);
});

test('8. ADVERSARIAL: zero filings cannot produce a credential', () => {
  // The earlier design read a private counter, so a subject could claim any
  // number. Now the proof needs Merkle paths into the public nullifier tree,
  // and there is no path to a leaf that was never inserted. The private state
  // is under the attacker's control and it no longer buys anything.
  const e = setup();
  assert.equal(ledger(e.state).spentFilingNullifiers.size(), 0n, 'nothing on chain');

  assert.throws(
    () => present(e, e.state, SOFIA, [CASE_A, CASE_B, CASE_C], VERIFIER),
    /no filing on record/i,
    'with nothing on chain there are no paths to present',
  );

  // Now the interesting half. The attacker builds their OWN tree containing
  // nullifiers they can legitimately derive, and presents paths into it.
  const forged = createMerkleMirror();
  const leaves = [CASE_A, CASE_B, CASE_C].map((c) => pureCircuits.filingNullifierOf(SOFIA, c));
  for (const l of leaves) forged.insert(l);

  const out = present(e, e.state, SOFIA, [CASE_A, CASE_B, CASE_C], VERIFIER, {
    paths: leaves.map((l) => forged.pathFor(l)),
    root: forged.root(),
  });
  assert.equal(out.result, true, 'the CIRCUIT accepts it — it cannot bind the root to the chain');

  // Which is exactly why the verifier check is not optional.
  assert.throws(
    () => assertClaimedRootIsOnChain(ledger(e.state), forged.root()),
    /not a root of the on-chain/i,
    'the off-chain guard is what closes the hole',
  );

  // And the honest path passes the same guard.
  const real = threeFilings(e);
  assertClaimedRootIsOnChain(ledger(real), ledger(real).filingNullifierTree.root());
});

test('9. ADVERSARIAL: one filing cannot be presented three times', () => {
  const e = setup();
  const s = file(e, e.state, SOFIA, CASE_A);
  assert.throws(
    () => present(e, s, SOFIA, [CASE_A, CASE_A, CASE_A], VERIFIER),
    /must be distinct/i,
  );
});

test('10. ADVERSARIAL: you cannot present another subject’s filings', () => {
  const e = setup();
  const s = threeFilings(e);

  // OTHER filed nothing, but the tree is full of SOFIA's nullifiers. Handing
  // the paths over does not help: each leaf must derive from the presenter's
  // own secret.
  const tree = ledger(s).filingNullifierTree;
  const stolen = [CASE_A, CASE_B, CASE_C].map(
    (c) => tree.findPathForLeaf(pureCircuits.filingNullifierOf(SOFIA, c)) as unknown as LeafPath,
  );

  assert.throws(
    () => present(e, s, OTHER, [CASE_A, CASE_B, CASE_C], VERIFIER, { paths: stolen }),
    /not a nullifier of the caller/i,
  );
});

test('11. a rejected presentation does not burn the verifier context', () => {
  const e = setup();
  const s = threeFilings(e);

  assert.throws(
    () => present(e, s, SOFIA, [CASE_A, CASE_A, CASE_B], VERIFIER),
    /must be distinct/i,
  );

  const ok = present(e, s, SOFIA, [CASE_A, CASE_B, CASE_C], VERIFIER);
  assert.equal(ok.result, true, 'the failed attempt consumed nothing');

  assert.throws(
    () => present(e, ok.state, SOFIA, [CASE_A, CASE_B, CASE_C], VERIFIER),
    /already presented/i,
  );
  assert.equal(
    present(e, ok.state, SOFIA, [CASE_A, CASE_B, CASE_C], OTHER_VERIFIER).result,
    true,
    'a different verifier is a fresh context',
  );
});

test('12. output B: per-case counter and the under-review flag', () => {
  const e = setup([CASE_A], 3n);
  let s = e.state;

  assert.equal(ledger(s).caseReports.member(CASE_A), false, 'no entry before the first filing');

  s = file(e, s, SOFIA, CASE_A);
  assert.equal(ledger(s).caseReports.lookup(CASE_A).read(), 1n);
  assert.equal(ledger(s).casesUnderReview.member(CASE_A), false);

  s = file(e, s, OTHER, CASE_A);
  s = file(e, s, THIRD, CASE_A);
  const l = ledger(s);
  assert.equal(l.caseReports.lookup(CASE_A).read(), 3n);
  assert.equal(l.casesUnderReview.member(CASE_A), true, 'threshold reached');
  assert.equal(l.casesUnderReview.size(), 1n, 'listed once, not once per report');
});

test('13. KNOWN LIMITATION: output B counts secrets, not people', () => {
  // subjectSecret is unanchored — nothing ties it to a person. One actor with
  // three invented secrets moves the public counter and trips the flag. Output
  // A is unaffected: its claim is "I filed these", which stays true. The public
  // alarm, however, is NOT Sybil-resistant. Anchoring identity is the next
  // step; this test exists so the gap cannot quietly become a claim.
  const e = setup([CASE_A], 3n);
  let s = e.state;
  for (const invented of [b32(0xf1), b32(0xf2), b32(0xf3)]) {
    s = file(e, s, invented, CASE_A);
  }

  assert.equal(ledger(s).caseReports.lookup(CASE_A).read(), 3n);
  assert.equal(
    ledger(s).casesUnderReview.member(CASE_A),
    true,
    'documented gap: one actor reached the threshold alone',
  );
});

test('14. the subject secret never appears in public state', () => {
  const e = setup();
  const s = threeFilings(e);
  const l = ledger(s);

  // Iterate the ADTs. JSON.stringify over a ledger object serialises the
  // collections as {} even when populated, so a dump-and-grep test asserts
  // nothing at all.
  const published = [
    ...[...l.spentFilingNullifiers].map(toHex),
    ...[...l.spentPresentationNullifiers].map(toHex),
  ];

  assert.equal(published.length, 3, 'the test actually inspected published entries');
  assert.ok(!published.includes(toHex(SOFIA)), 'the secret is not in the ledger');
  for (const c of [CASE_A, CASE_B, CASE_C]) {
    assert.ok(!published.includes(toHex(c)), 'raw case commitments are not the published values');
  }
});

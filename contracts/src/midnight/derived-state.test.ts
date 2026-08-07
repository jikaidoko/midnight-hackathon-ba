// derived-state.test.ts — the reporter's view, in the simulator.
//
// `deriveReporterView` is what a UI decides with: whether to offer a filing
// button, whether to offer the credential, whether to warn that nothing is
// fileable at all. Getting it wrong does not corrupt any state, it just makes
// the interface confidently lie — offer a button that produces a failing proof,
// or hide one that would have worked.
//
// So each case here is a question the interface has to answer, and the answer is
// checked against a chain state built by really running the circuits.
//
// Coverage:
//   1. Fresh registry: every case fileable, no credential.
//   2. `hasFiled` is per reporter, not global.
//   3. `myFilingCount` is counted from the chain, and the credential unlocks
//      at exactly three.
//   4. Public corroboration and the under-review flag.
//   5. ADVERSARIAL — a reporter with a different secret sees none of it as
//      theirs, which is the privacy property showing up in the view.
//   6. Registry divergence disables filing across the board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract as CaseAdmission,
  ledger as caseLedgerOf,
  pureCircuits as casePure,
} from '../managed/case_admission/contract/index.js';
import {
  Contract as FilingRegistry,
  ledger as filingLedgerOf,
} from '../managed/filing_registry/contract/index.js';
import { witnesses as authorityWitnesses } from '../witnesses.js';
import { witnesses as subjectWitnesses, createSubjectPrivateState } from '../filing-witnesses.js';
import { createMerkleMirror, type LeafPath } from '../merkle-mirror.js';
import { deriveReporterView, CREDENTIAL_FILINGS } from './derived-state.js';

const COIN_PK = '00'.repeat(32);
const b32 = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

const AUTHORITY = b32(0xa0);
const SOFIA = b32(0x50);
const NEIGHBOUR_1 = b32(0x60);
const NEIGHBOUR_2 = b32(0x70);
const STRANGER = b32(0x80);

const CASE_A = b32(0x11);
const CASE_B = b32(0x22);
const CASE_C = b32(0x33);
const LATE_CASE = b32(0x44);

const THRESHOLD = 3n;

/** Both contracts, wired the way the deployment scripts wire them. */
function setup(admitted: Uint8Array[] = [CASE_A, CASE_B, CASE_C]) {
  const registry = createMerkleMirror();
  const admission = new CaseAdmission(authorityWitnesses);
  const addr = dummyContractAddress();

  let caseState = admission.initialState(
    createConstructorContext({ authoritySecret: AUTHORITY }, COIN_PK),
    casePure.authorityDigest(AUTHORITY),
    registry.root(),
  ).currentContractState.data;

  const admit = (kase: Uint8Array) => {
    const newRoot = registry.insert(kase);
    const ctx = createCircuitContext(addr, COIN_PK, caseState, { authoritySecret: AUTHORITY });
    caseState = admission.circuits.admitCase(ctx, kase, newRoot).context.currentQueryContext.state;
  };
  for (const kase of admitted) admit(kase);

  const filing = new FilingRegistry(subjectWitnesses);
  let filingState = filing.initialState(
    createConstructorContext(createSubjectPrivateState(SOFIA), COIN_PK),
    registry.root(),
    THRESHOLD,
  ).currentContractState.data;

  const file = (secret: Uint8Array, kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, filingState, createSubjectPrivateState(secret));
    filingState = filing.circuits
      .registerFiling(ctx, kase, registry.pathFor(kase) as unknown as LeafPath)
      .context.currentQueryContext.state;
  };

  const view = (secret: Uint8Array) =>
    deriveReporterView(
      caseLedgerOf(caseState),
      filingLedgerOf(filingState),
      secret,
      THRESHOLD,
    );

  return { admit, file, view };
}

const caseOf = (v: ReturnType<ReturnType<typeof setup>['view']>, kase: Uint8Array) => {
  const hex = Buffer.from(kase).toString('hex');
  const found = v.cases.find((c) => c.caseCommitment === hex);
  assert.ok(found, `case ${hex.slice(0, 8)} missing from the view`);
  return found;
};

test('1. a fresh registry: every case fileable, no credential yet', () => {
  const v = setup().view(SOFIA);

  assert.equal(v.cases.length, 3, 'all three admitted cases are visible');
  assert.equal(v.myFilingCount, 0);
  assert.equal(v.canPresentCredential, false);
  assert.equal(v.registryDiverged, false);
  assert.equal(v.admittedRootLive, v.admittedRootFrozen);

  for (const c of v.cases) {
    assert.equal(c.hasFiled, false);
    assert.equal(c.canFile, true);
    assert.equal(c.reports, 0n);
    assert.equal(c.underReview, false);
  }
});

test('2. hasFiled is per reporter, not global', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);

  const sofia = e.view(SOFIA);
  assert.equal(caseOf(sofia, CASE_A).hasFiled, true, 'Sofía sees her own filing');
  assert.equal(caseOf(sofia, CASE_A).canFile, false, 'and is not offered it again');

  const neighbour = e.view(NEIGHBOUR_1);
  assert.equal(caseOf(neighbour, CASE_A).hasFiled, false, 'the neighbour has not filed');
  assert.equal(caseOf(neighbour, CASE_A).canFile, true, 'and is still offered it');

  // The public count moved for both; only the private flag differs.
  assert.equal(caseOf(sofia, CASE_A).reports, 1n);
  assert.equal(caseOf(neighbour, CASE_A).reports, 1n);
});

test('3. the credential unlocks at exactly three filings, counted on chain', () => {
  const e = setup();

  e.file(SOFIA, CASE_A);
  assert.equal(e.view(SOFIA).myFilingCount, 1);
  assert.equal(e.view(SOFIA).canPresentCredential, false);

  e.file(SOFIA, CASE_B);
  assert.equal(e.view(SOFIA).myFilingCount, 2);
  assert.equal(e.view(SOFIA).canPresentCredential, false, 'two is not enough');

  e.file(SOFIA, CASE_C);
  const v = e.view(SOFIA);
  assert.equal(v.myFilingCount, CREDENTIAL_FILINGS);
  assert.equal(v.canPresentCredential, true, 'three unlocks it');
});

test('4. corroboration is public, and the flag flips at the threshold', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(NEIGHBOUR_1, CASE_A);

  let v = e.view(SOFIA);
  assert.equal(caseOf(v, CASE_A).reports, 2n);
  assert.equal(caseOf(v, CASE_A).underReview, false, 'two is below the bar');

  e.file(NEIGHBOUR_2, CASE_A);
  v = e.view(SOFIA);
  assert.equal(caseOf(v, CASE_A).reports, 3n);
  assert.equal(caseOf(v, CASE_A).underReview, true);

  // Untouched cases are unaffected.
  assert.equal(caseOf(v, CASE_B).reports, 0n);
  assert.equal(caseOf(v, CASE_B).underReview, false);
});

test('5. ADVERSARIAL: a stranger sees the public counts and none of the filings', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(SOFIA, CASE_B);
  e.file(SOFIA, CASE_C);

  const stranger = e.view(STRANGER);

  // The corroboration counts are public and the stranger reads them fine.
  assert.equal(caseOf(stranger, CASE_A).reports, 1n);

  // But nothing on chain tells them any of it was one person's, let alone whose.
  assert.equal(stranger.myFilingCount, 0, 'no filing is attributable to them');
  assert.equal(stranger.canPresentCredential, false);
  for (const c of stranger.cases) {
    assert.equal(c.hasFiled, false);
    assert.equal(c.canFile, true, 'and every case is still open to them');
  }

  // Same chain state, two views. That difference IS the privacy property: the
  // link between a filing and a reporter exists only where the secret is.
  assert.equal(e.view(SOFIA).myFilingCount, 3);
});

test('6. a case admitted after deployment makes nothing fileable', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.admit(LATE_CASE);

  const v = e.view(SOFIA);

  assert.equal(v.registryDiverged, true);
  assert.notEqual(v.admittedRootLive, v.admittedRootFrozen);
  assert.equal(v.cases.length, 4, 'the late case is visible in the registry');

  // Not just the late one: the frozen root no longer matches ANY current path,
  // so every filing would fail. An interface that greyed out only the new case
  // would be wrong in the most confusing way available.
  for (const c of v.cases) {
    assert.equal(c.canFile, false, `case ${c.caseCommitment.slice(0, 8)} should be blocked`);
  }

  // The filing already on chain is unaffected; it is history, not a projection.
  assert.equal(caseOf(v, CASE_A).hasFiled, true);
  assert.equal(v.myFilingCount, 1);
});

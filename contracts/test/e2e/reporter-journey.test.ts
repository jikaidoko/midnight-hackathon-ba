// reporter-journey.test.ts — the product journey, end to end, across BOTH
// contracts. This is the demo script as an executable test.
//
//   1. The oversight authority admits three cases to the public registry.
//   2. Sofía files a report against each one. Nobody learns who she is.
//   3. Two more reporters file against the same case, independently.
//   4. That case crosses the threshold and flips to UNDER REVIEW in public.
//   5. Sofía proves to a verifier that she has three prior filings — without
//      revealing which, when, or who she is. The verifier sees a boolean.
//   6. The verifier performs its off-chain obligation and the proof holds.
//
// Runs in the simulator: no proof generation, no network, no proof server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract as CaseAdmission,
  ledger as caseLedger,
  pureCircuits as casePure,
} from '../../src/managed/case_admission/contract/index.js';
import {
  Contract as FilingRegistry,
  ledger as filingLedger,
  pureCircuits as filingPure,
} from '../../src/managed/filing_registry/contract/index.js';
import { witnesses as authorityWitnesses } from '../../src/witnesses.js';
import {
  witnesses as subjectWitnesses,
  createSubjectPrivateState,
} from '../../src/filing-witnesses.js';
import { createMerkleMirror, toHex, type LeafPath } from '../../src/merkle-mirror.js';
import { assertClaimedRootIsOnChain } from '../../src/verifier.js';

const COIN_PK = '00'.repeat(32);
const b32 = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

const AUTHORITY = b32(0xa0);

// Sofía and two neighbours. Fictional, like every name in this project.
const SOFIA = b32(0x50);
const NEIGHBOUR_1 = b32(0x60);
const NEIGHBOUR_2 = b32(0x70);

// Opaque case commitments. The contract learns nothing about the cases.
const DUMPING = b32(0x11);
const CASE_2 = b32(0x22);
const CASE_3 = b32(0x33);

const COURT = b32(0x01);
const REVIEW_THRESHOLD = 3n;

test('the full reporter journey, across both contracts', () => {
  // ─── 1. The authority admits three cases ──────────────────────────────────
  // One shared mirror implementation for both trees. R1a's case-registry.ts
  // cannot produce membership paths, and the filing registry needs them.
  const registry = createMerkleMirror();
  const admission = new CaseAdmission(authorityWitnesses);
  const addr = dummyContractAddress();

  let caseState = admission.initialState(
    createConstructorContext({ authoritySecret: AUTHORITY }, COIN_PK),
    casePure.authorityDigest(AUTHORITY),
    registry.root(),
  ).currentContractState.data;

  for (const kase of [DUMPING, CASE_2, CASE_3]) {
    const newRoot = registry.insert(kase);
    const ctx = createCircuitContext(addr, COIN_PK, caseState, { authoritySecret: AUTHORITY });
    caseState = admission.circuits.admitCase(ctx, kase, newRoot).context.currentQueryContext.state;
  }

  assert.equal(caseLedger(caseState).admittedCount, 3n, 'three cases admitted');

  // ─── 2. The filing registry is deployed against that registry ─────────────
  // NOTE: the root is passed at construction and never updated. The two
  // contracts are not merged yet, so a case admitted AFTER this point cannot
  // be filed against — pinned down at the end of this test.
  const filing = new FilingRegistry(subjectWitnesses);
  let state = filing.initialState(
    createConstructorContext(createSubjectPrivateState(SOFIA), COIN_PK),
    registry.root(),
    REVIEW_THRESHOLD,
  ).currentContractState.data;

  const file = (secret: Uint8Array, kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createSubjectPrivateState(secret));
    state = filing.circuits
      .registerFiling(ctx, kase, registry.pathFor(kase) as unknown as LeafPath)
      .context.currentQueryContext.state;
  };

  // ─── 3. Sofía files against all three cases ───────────────────────────────
  file(SOFIA, DUMPING);
  file(SOFIA, CASE_2);
  file(SOFIA, CASE_3);

  // Nothing about her is legible on chain.
  const published = [...filingLedger(state).spentFilingNullifiers].map(toHex);
  assert.equal(published.length, 3, 'three filings recorded');
  assert.ok(!published.includes(toHex(SOFIA)), 'her secret is not on chain');

  // ─── 4. Two neighbours report the same dumping case ───────────────────────
  assert.equal(
    filingLedger(state).casesUnderReview.member(DUMPING),
    false,
    'one report is not enough to flag a site',
  );

  file(NEIGHBOUR_1, DUMPING);
  file(NEIGHBOUR_2, DUMPING);

  const l = filingLedger(state);
  assert.equal(l.caseReports.lookup(DUMPING).read(), 3n, 'three independent reports');
  assert.equal(
    l.casesUnderReview.member(DUMPING),
    true,
    'the site is now publicly UNDER REVIEW — because reports converged, not because anyone was named',
  );

  // ─── 5. Sofía proves three prior filings to the court ─────────────────────
  const tree = filingLedger(state).filingNullifierTree;
  const paths = [DUMPING, CASE_2, CASE_3].map((c) => {
    const p = tree.findPathForLeaf(filingPure.filingNullifierOf(SOFIA, c));
    if (!p) throw new Error('no filing on record');
    return p as unknown as LeafPath;
  });
  const claimedRoot = tree.root();

  const ctx = createCircuitContext(addr, COIN_PK, state, createSubjectPrivateState(SOFIA));
  const presented = filing.circuits.proveRepeatFilings(
    ctx, [DUMPING, CASE_2, CASE_3], paths as never, claimedRoot, COURT,
  );

  assert.equal(presented.result, true, 'the court receives TRUE and nothing else');
  state = presented.context.currentQueryContext.state;

  // ─── 6. The verifier does its off-chain half ──────────────────────────────
  assertClaimedRootIsOnChain(filingLedger(state), claimedRoot);

  // What the court can see afterwards: one spent presentation nullifier. Not
  // her identity, not which cases she filed, not how many she really has.
  const presentations = [...filingLedger(state).spentPresentationNullifiers].map(toHex);
  assert.equal(presentations.length, 1);
  assert.ok(!presentations.includes(toHex(SOFIA)));
  for (const c of [DUMPING, CASE_2, CASE_3]) {
    assert.ok(!presentations.includes(toHex(c)), 'the cases she used are not revealed');
  }

  // ─── The integration gap, pinned ──────────────────────────────────────────
  // A case admitted after the filing registry was deployed cannot be filed
  // against, because its root is frozen at construction. This is the reason
  // the two contracts still need to be merged into one.
  const LATE_CASE = b32(0x44);
  const lateRoot = registry.insert(LATE_CASE);
  const lateCtx = createCircuitContext(addr, COIN_PK, caseState, { authoritySecret: AUTHORITY });
  admission.circuits.admitCase(lateCtx, LATE_CASE, lateRoot);

  assert.throws(
    () => file(SOFIA, LATE_CASE),
    /not in the admitted registry/i,
    'KNOWN GAP: the filing registry cannot see cases admitted after its deployment',
  );
});

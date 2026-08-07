// reporter-journey.test.ts — the product journey, end to end. This is the demo
// script as an executable test.
//
//   1. The oversight authority admits three cases to the public registry.
//   2. Sofía files a report against each one. Nobody learns who she is.
//   3. Two more reporters file against the same case, independently.
//   4. That case crosses the threshold and flips to UNDER REVIEW in public.
//   5. Sofía proves to a verifier that she has three prior filings — without
//      revealing which, when, or who she is. The verifier sees a boolean.
//   6. The verifier re-checks the anchor off-chain, as a second source, and
//      reaches the same verdict the circuit already enforced.
//   7. A case admitted AFTER all of that is filable immediately.
//
// Step 7 used to be the opposite: it asserted that a late case could NEVER be
// filed against, because the filing contract froze the admitted root at
// construction. That was the cost of two contracts, and it is gone.
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
  Contract,
  ledger,
  pureCircuits,
} from '../../src/managed/amparo/contract/index.js';
import {
  witnesses,
  createAuthorityState,
  createSubjectState,
} from '../../src/amparo-witnesses.js';
import { type LeafPath } from '../../src/merkle-mirror.js';
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
const LATE_CASE = b32(0x44);

const COURT = b32(0x01);
const REVIEW_THRESHOLD = 3n;

test('the full reporter journey', () => {
  const contract = new Contract(witnesses);
  const addr = dummyContractAddress();

  let state = contract.initialState(
    createConstructorContext(createAuthorityState(AUTHORITY), COIN_PK),
    pureCircuits.authorityDigest(AUTHORITY),
    REVIEW_THRESHOLD,
  ).currentContractState.data;

  const admit = (kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createAuthorityState(AUTHORITY));
    state = contract.circuits.admitCase(ctx, kase).context.currentQueryContext.state;
  };

  const file = (secret: Uint8Array, kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createSubjectState(secret));
    state = contract.circuits.registerFiling(ctx, kase).context.currentQueryContext.state;
  };

  // ─── 1. The authority admits three cases ──────────────────────────────────
  for (const kase of [DUMPING, CASE_2, CASE_3]) admit(kase);
  assert.equal(ledger(state).admittedCount, 3n, 'three cases admitted');

  // ─── 2. Sofía files against each one ──────────────────────────────────────
  for (const kase of [DUMPING, CASE_2, CASE_3]) file(SOFIA, kase);

  // Nothing on chain says it was her, or that it was one person at all.
  const afterSofia = ledger(state);
  assert.equal(afterSofia.spentFilingNullifiers.size(), 3n);
  assert.equal(afterSofia.caseReports.lookup(DUMPING).read(), 1n);
  assert.equal(afterSofia.casesUnderReview.member(DUMPING), false, 'one report is not enough');

  // ─── 3 & 4. Two neighbours corroborate, and the flag flips ────────────────
  file(NEIGHBOUR_1, DUMPING);
  assert.equal(ledger(state).casesUnderReview.member(DUMPING), false, 'two is still below');

  file(NEIGHBOUR_2, DUMPING);
  const flagged = ledger(state);
  assert.equal(flagged.caseReports.lookup(DUMPING).read(), 3n);
  assert.equal(flagged.casesUnderReview.member(DUMPING), true, 'UNDER REVIEW, in public');
  assert.equal(flagged.casesUnderReview.member(CASE_2), false, 'and only that case');

  // ─── 5. Sofía presents the credential ─────────────────────────────────────
  const tree = ledger(state).filingNullifierTree;
  const claimedRoot = tree.root();
  const paths = [DUMPING, CASE_2, CASE_3].map(
    (kase) =>
      tree.findPathForLeaf(
        pureCircuits.filingNullifierOf(SOFIA, kase),
      ) as unknown as LeafPath,
  );

  const presentCtx = createCircuitContext(addr, COIN_PK, state, createSubjectState(SOFIA));
  const presented = contract.circuits.proveRepeatFilings(
    presentCtx,
    [DUMPING, CASE_2, CASE_3],
    paths as never,
    claimedRoot,
    COURT,
  );
  state = presented.context.currentQueryContext.state;

  // The verifier sees a boolean. Not which cases, not when, not who.
  assert.equal(presented.result, true);
  assert.equal(ledger(state).spentPresentationNullifiers.size(), 1n, 'the context is spent');

  // ─── 6. The verifier re-checks the anchor off-chain ───────────────────────
  assertClaimedRootIsOnChain(ledger(state), claimedRoot);

  // ─── 7. A case admitted after everything is filable immediately ───────────
  admit(LATE_CASE);
  file(SOFIA, LATE_CASE);
  assert.equal(ledger(state).caseReports.lookup(LATE_CASE).read(), 1n);
  assert.equal(ledger(state).admittedCount, 4n);
});

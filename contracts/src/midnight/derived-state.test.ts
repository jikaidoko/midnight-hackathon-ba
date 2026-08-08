// derived-state.test.ts — the reporter's view, in the simulator.
//
// `deriveReporterView` is what a UI decides with: whether to offer a filing
// button, whether to offer the credential. Getting it wrong does not corrupt any
// state, it just makes the interface confidently lie — offer a button that
// produces a failing proof, or hide one that would have worked.
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
//   6. A case admitted late appears and is immediately fileable.
//
// Then the PUBLIC view, which is the same chain state with no secret at all:
//   7. It reports corroboration and the flag, and agrees with the reporter view
//      on every public number.
//   8. `reportsToReview` counts down and clamps at zero past the bar.
//   9. Aggregates sum across cases, not within one.
//  10. ADVERSARIAL — nothing a reporter's secret produced appears in it, with
//      three filings by one person on chain to produce something.

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
} from '../managed/amparo/contract/index.js';
import {
  witnesses,
  createAuthorityState,
  createSubjectState,
} from '../amparo-witnesses.js';
import {
  deriveReporterView,
  derivePublicView,
  CREDENTIAL_FILINGS,
} from './derived-state.js';

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

function setup(admitted: Uint8Array[] = [CASE_A, CASE_B, CASE_C]) {
  const contract = new Contract(witnesses);
  const addr = dummyContractAddress();

  let state = contract.initialState(
    createConstructorContext(createAuthorityState(AUTHORITY), COIN_PK),
    pureCircuits.authorityDigest(AUTHORITY),
    THRESHOLD,
  ).currentContractState.data;

  const admit = (kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createAuthorityState(AUTHORITY));
    state = contract.circuits.admitCase(ctx, kase).context.currentQueryContext.state;
  };
  for (const kase of admitted) admit(kase);

  const file = (secret: Uint8Array, kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createSubjectState(secret));
    state = contract.circuits.registerFiling(ctx, kase).context.currentQueryContext.state;
  };

  const view = (secret: Uint8Array) =>
    deriveReporterView(ledger(state), secret, THRESHOLD);

  // No secret parameter, because the function has none to take.
  const publicView = () => derivePublicView(ledger(state), THRESHOLD);

  return { admit, file, view, publicView };
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
  assert.equal(v.admittedCount, 3n);
  assert.equal(v.myFilingCount, 0);
  assert.equal(v.canPresentCredential, false);

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

  assert.equal(caseOf(v, CASE_B).reports, 0n, 'untouched cases are unaffected');
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

test('6. a case admitted late shows up and is immediately fileable', () => {
  // Before unification this was the broken case: the filing side froze the
  // admitted root at construction, so a later admission was permanently
  // unfilable and the view had to carry a `registryDiverged` flag telling the
  // reporter that nothing at all could be filed. One contract, no frozen root.
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.admit(LATE_CASE);

  const v = e.view(SOFIA);
  assert.equal(v.cases.length, 4);
  assert.equal(v.admittedCount, 4n);
  assert.equal(caseOf(v, LATE_CASE).canFile, true, 'immediately fileable');

  e.file(SOFIA, LATE_CASE);
  const after = e.view(SOFIA);
  assert.equal(caseOf(after, LATE_CASE).hasFiled, true);
  assert.equal(after.myFilingCount, 2);

  // And the earlier filing is untouched.
  assert.equal(caseOf(after, CASE_A).hasFiled, true);
});

// ---------------------------------------------------------------------------
// The public view
// ---------------------------------------------------------------------------

const publicCaseOf = (
  v: ReturnType<ReturnType<typeof setup>['publicView']>,
  kase: Uint8Array,
) => {
  const hex = Buffer.from(kase).toString('hex');
  const found = v.cases.find((c) => c.caseCommitment === hex);
  assert.ok(found, `case ${hex.slice(0, 8)} missing from the public view`);
  return found;
};

test('7. the public view reports corroboration, and agrees with the reporter view', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(NEIGHBOUR_1, CASE_A);

  const pub = e.publicView();
  assert.equal(pub.cases.length, 3);
  assert.equal(pub.admittedCount, 3n);
  assert.equal(publicCaseOf(pub, CASE_A).reports, 2n);
  assert.equal(publicCaseOf(pub, CASE_A).underReview, false);

  // Same chain, same public numbers, whoever is asking. The reporter view adds
  // private answers on top; it does not disagree about the public ones.
  const sofia = e.view(SOFIA);
  const stranger = e.view(STRANGER);
  for (const v of [sofia, stranger]) {
    assert.equal(caseOf(v, CASE_A).reports, publicCaseOf(pub, CASE_A).reports);
    assert.equal(caseOf(v, CASE_A).underReview, publicCaseOf(pub, CASE_A).underReview);
    assert.equal(v.admittedCount, pub.admittedCount);
  }
});

test('8. reportsToReview counts down, and clamps at zero past the bar', () => {
  const e = setup();

  assert.equal(publicCaseOf(e.publicView(), CASE_A).reportsToReview, 3n);

  e.file(SOFIA, CASE_A);
  assert.equal(publicCaseOf(e.publicView(), CASE_A).reportsToReview, 2n);

  e.file(NEIGHBOUR_1, CASE_A);
  const two = publicCaseOf(e.publicView(), CASE_A);
  assert.equal(two.reportsToReview, 1n, 'one short, and the flag is still down');
  assert.equal(two.underReview, false);

  e.file(NEIGHBOUR_2, CASE_A);
  const flipped = publicCaseOf(e.publicView(), CASE_A);
  assert.equal(flipped.underReview, true, 'the third report flips it');
  assert.equal(flipped.reportsToReview, 0n);

  // Past the bar it stays zero rather than going negative, which is what the
  // clamp is for: a fourth report must not read as "-1 to review".
  e.file(STRANGER, CASE_A);
  const past = publicCaseOf(e.publicView(), CASE_A);
  assert.equal(past.reports, 4n);
  assert.equal(past.reportsToReview, 0n);
  assert.equal(past.underReview, true, 'and the flag is idempotent');
});

test('9. aggregates sum across cases, not within one', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(NEIGHBOUR_1, CASE_A);
  e.file(NEIGHBOUR_2, CASE_A); // CASE_A flips
  e.file(SOFIA, CASE_B);

  const pub = e.publicView();
  assert.equal(pub.totalReports, 4n, 'three on A plus one on B');
  assert.equal(pub.underReviewCount, 1, 'only A crossed');
  assert.equal(pub.reviewThreshold, THRESHOLD);

  // An admitted case nobody reported still appears, at zero.
  assert.equal(publicCaseOf(pub, CASE_C).reports, 0n);
  assert.equal(pub.cases.length, 3);
});

test('10. ADVERSARIAL: no reporter-derived value reaches the public view', () => {
  // Three filings by ONE reporter, so there is something to leak: three
  // nullifiers on chain that all derive from Sofía's secret. Anyone may read
  // them - they are public ledger state - and linking them to each other is
  // exactly what would undo the credential's privacy.
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(SOFIA, CASE_B);
  e.file(SOFIA, CASE_C);
  assert.equal(e.view(SOFIA).myFilingCount, 3, 'the filings really are on chain');

  const serialized = JSON.stringify(e.publicView(), (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

  for (const kase of [CASE_A, CASE_B, CASE_C]) {
    const nullifier = Buffer.from(pureCircuits.filingNullifierOf(SOFIA, kase)).toString('hex');
    assert.ok(
      !serialized.includes(nullifier),
      'a filing nullifier reached the public view',
    );
  }
  assert.ok(!serialized.includes(Buffer.from(SOFIA).toString('hex')), 'the secret itself leaked');

  // The case commitments DO appear, and that is not a leak: `registerFiling`
  // discloses the case because it is the key of the public counter. What must
  // not appear is anything joining a case to a person.
  assert.ok(serialized.includes(Buffer.from(CASE_A).toString('hex')));

  // The shape check the two above cannot make: every field is accounted for, so
  // a field added later that carries a nullifier fails here rather than sliding
  // past a substring search.
  assert.deepEqual(
    Object.keys(e.publicView()).sort(),
    [
      'admittedCount',
      'approaching',
      'cases',
      'reviewThreshold',
      'totalReports',
      'unanswered',
      'underReview',
      'underReviewCount',
    ],
  );

  // `answered` arrives alone, and that is the design rather than an omission:
  // `kind`, `grounds` and `detail` are absent entirely on a case with no
  // answer, not present and undefined. This harness has no authority secret so
  // it cannot produce the answered shape; those three keys are accounted for
  // where a response can actually be recorded.
  assert.deepEqual(
    Object.keys(publicCaseOf(e.publicView(), CASE_A)).sort(),
    [
      'answered',
      'caseCommitment',
      'reports',
      'reportsAfterEscalation',
      'reportsToReview',
      'underReview',
    ],
  );
});

// ---------------------------------------------------------------------------
// The backlog partition — what an oversight screen works through
// ---------------------------------------------------------------------------

const hexOf = (kase: Uint8Array) => Buffer.from(kase).toString('hex');

test('11. the two groups partition the registry at the contract’s own flag', () => {
  const e = setup();

  let v = e.publicView();
  assert.equal(v.underReview.length, 0, 'nothing is the body’s to answer yet');
  assert.equal(v.approaching.length, 3);

  e.file(SOFIA, CASE_A);
  e.file(NEIGHBOUR_1, CASE_A);
  v = e.publicView();
  assert.equal(v.underReview.length, 0, 'two is below the bar');
  assert.equal(v.approaching.length, 3);

  e.file(NEIGHBOUR_2, CASE_A);
  v = e.publicView();
  assert.deepEqual(v.underReview.map((c) => c.caseCommitment), [hexOf(CASE_A)]);
  assert.equal(v.approaching.length, 2);

  // A partition, not a filter: nothing is dropped and nothing is counted twice.
  assert.equal(v.underReview.length + v.approaching.length, v.cases.length);
  assert.equal(v.underReview.length, v.underReviewCount);
});

test('12. both groups are ordered most corroborated first', () => {
  const e = setup();

  for (const s of [SOFIA, NEIGHBOUR_1, NEIGHBOUR_2]) e.file(s, CASE_B);
  for (const s of [SOFIA, NEIGHBOUR_1, NEIGHBOUR_2, STRANGER]) e.file(s, CASE_A);
  e.file(SOFIA, CASE_C);

  const v = e.publicView();
  assert.deepEqual(
    v.underReview.map((c) => c.caseCommitment),
    [hexOf(CASE_A), hexOf(CASE_B)],
    'four corroborations outrank three',
  );

  e.admit(LATE_CASE);
  assert.deepEqual(
    e.publicView().approaching.map((c) => c.caseCommitment),
    [hexOf(CASE_C), hexOf(LATE_CASE)],
    'one corroboration outranks none',
  );

  // `cases` keeps the ledger's own order, which the partitions must not disturb.
  //
  // Asserted as "not sorted by corroboration" rather than against a literal
  // sequence: `admittedIndex` does NOT iterate in insertion order. Measured -
  // admitting A, B, C then LATE yields B, C, LATE, A. So a literal expectation
  // would encode an ADT internal that nobody promised, and the field's contract
  // is only that it is the ledger's order rather than a view's.
  const v2 = e.publicView();
  const order = v2.cases.map((c) => c.reports);
  const descending = [...order].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  assert.notDeepEqual(
    order,
    descending,
    '`cases` came back sorted by corroboration: the partition sorted it in place',
  );
  assert.deepEqual(
    [...v2.underReview, ...v2.approaching].map((c) => c.caseCommitment).sort(),
    v2.cases.map((c) => c.caseCommitment).sort(),
    'the two groups are a partition of `cases`, not a different set',
  );
});

test('13. reportsAfterEscalation counts only what arrived after the bar', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(NEIGHBOUR_1, CASE_A);
  e.file(NEIGHBOUR_2, CASE_A);

  // At exactly the threshold nobody has reported "after" anything. A view that
  // said 1 here would tell the official they were already late on day one.
  assert.equal(publicCaseOf(e.publicView(), CASE_A).reportsAfterEscalation, 0n);

  e.file(STRANGER, CASE_A);
  assert.equal(
    publicCaseOf(e.publicView(), CASE_A).reportsAfterEscalation,
    1n,
    'one person reported a case that was already the body’s to answer',
  );

  for (const c of e.publicView().approaching) {
    assert.equal(c.reportsAfterEscalation, 0n, 'nothing is late before it escalates');
  }
});

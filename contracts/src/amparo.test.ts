// amparo.test.ts — the unified contract, in the Compact runtime SIMULATOR.
// Deploy-free and prover-free: it runs circuit logic (asserts, state
// transitions) deterministically, without generating a ZK proof or touching a
// network, DUST or a proof server.
//
// Run: `npm test` (tsx resolves the .js -> .ts imports of the generated code;
// plain `node --test` does not).
//
// Ported from case_admission.test.ts and filing_registry.test.ts, which this
// replaces. Every case those two asserted is here, minus the ones that existed
// only because the contracts were split — see 21 and 22 for what took their
// place.
//
// Coverage, and why each case exists:
//   1. Initial state.
//   2. Admission: the case enters the registry and the aggregate reflects it.
//   3. ADVERSARIAL — a secret that is not the committed one cannot admit.
//   4. The same case cannot be admitted twice.
//   5. Filing happy path.
//   6. ADVERSARIAL — a case that was never admitted cannot be filed against.
//   7. The same reporter cannot file twice for the same case.
//   8. Nullifiers are bound to the PAIR, so different reporters may file the
//      same case. This is the mechanism, NOT Sybil resistance — see 18.
//   9. Credential happy path: three real filings produce a valid proof.
//  10. ADVERSARIAL — the central claim. Zero filings cannot produce a
//      credential, whatever the private state says.
//  11. ADVERSARIAL — one filing cannot be presented three times.
//  12. ADVERSARIAL — you cannot present another reporter's filings.
//  13. A rejected presentation does not burn the verifier context.
//  14. ADVERSARIAL — a forged tree is rejected in-circuit by `checkRoot`.
//  15. Public per-case counter and the under-review flag.
//  16. ADVERSARIAL — a prover whose witness answers with a DIFFERENT secret on
//      each read.
//  17. Neither secret ever appears in public state.
//  18. KNOWN LIMITATION, asserted so it cannot rot silently into a claim we do
//      not have: output B counts distinct SECRETS, not distinct PEOPLE.
//  19. A reporter cannot admit, and an authority cannot file — the private
//      state carries one role, and asking for the other names it.
//  20. The historic tree keeps accepting an old root after later admissions.
//  21. THE POINT OF UNIFYING — a case admitted after any number of filings is
//      immediately filable. This is the failure the split contracts had.
//  22. THE POINT OF UNIFYING — no input to `admitCase` can influence the root.
//      Replaces the old "mirror guard" case, whose attack surface is deleted
//      rather than defended.
//  23. Response happy path: an escalated case can be answered, on the record.
//  24. ADVERSARIAL — the control body cannot answer a case the public never
//      watched escalate. This is what stops a pre-emptive dismissal.
//  25. ADVERSARIAL — an impostor cannot answer.
//  26. An answer is written once and never rewritten.
//  27. THE OBSERVABLE — silence is publicly legible. An escalated case with no
//      entry is the evidence the whole circuit exists to produce.
//  28. Dismissal costs the same record as any other answer.
//  29. A reporter cannot answer.
//  30. KNOWN LIMITATION, asserted — one answer per case means a body that later
//      changes its mind has nowhere to say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract, ledger, pureCircuits, ResponseKind,
  type Ledger, type Witnesses,
} from './managed/amparo/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import {
  witnesses,
  createAuthorityState,
  createSubjectState,
  type AmparoPrivateState,
} from './amparo-witnesses.js';
import { createMerkleMirror, toHex, type LeafPath } from './merkle-mirror.js';
import { encodeGrounds, decodeGrounds, GROUNDS_BYTES } from './midnight/ledger.js';
import { derivePublicView } from './midnight/derived-state.js';

const COIN_PK = '00'.repeat(32);
const b32 = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

const AUTHORITY = b32(0xa0);
const IMPOSTOR = b32(0xa1);

const SOFIA = b32(0x50);
const OTHER = b32(0x60);
const THIRD = b32(0x70);

const CASE_A = b32(0x11);
const CASE_B = b32(0x22);
const CASE_C = b32(0x33);
const NEVER_ADMITTED = b32(0x99);

const VERIFIER = b32(0x01);
const OTHER_VERIFIER = b32(0x02);

const THRESHOLD = 3n;

type LedgerState = CircuitContext<AmparoPrivateState>['currentQueryContext']['state'];

function setup(
  admitted: Uint8Array[] = [CASE_A, CASE_B, CASE_C],
  reviewThreshold = THRESHOLD,
  useWitnesses: Witnesses<AmparoPrivateState> = witnesses,
) {
  const contract = new Contract<AmparoPrivateState>(useWitnesses);
  const addr = dummyContractAddress();

  let state = contract.initialState(
    createConstructorContext<AmparoPrivateState>(createAuthorityState(AUTHORITY), COIN_PK),
    pureCircuits.authorityDigest(AUTHORITY),
    reviewThreshold,
  ).currentContractState.data as LedgerState;

  const admit = (kase: Uint8Array, secret: Uint8Array = AUTHORITY) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createAuthorityState(secret));
    state = contract.circuits.admitCase(ctx, kase).context.currentQueryContext
      .state as LedgerState;
  };

  const file = (secret: Uint8Array, kase: Uint8Array) => {
    const ctx = createCircuitContext(addr, COIN_PK, state, createSubjectState(secret));
    state = contract.circuits.registerFiling(ctx, kase).context.currentQueryContext
      .state as LedgerState;
  };

  const present = (
    secret: Uint8Array,
    cases: Uint8Array[],
    opts: { root?: { field: bigint }; verifier?: Uint8Array; paths?: LeafPath[] } = {},
  ) => {
    const tree = ledger(state).filingNullifierTree;
    const paths =
      opts.paths ??
      cases.map(
        (c) =>
          tree.findPathForLeaf(
            pureCircuits.filingNullifierOf(secret, c),
          ) as unknown as LeafPath,
      );
    const ctx = createCircuitContext(addr, COIN_PK, state, createSubjectState(secret));
    const out = contract.circuits.proveRepeatFilings(
      ctx,
      cases,
      paths as never,
      opts.root ?? tree.root(),
      opts.verifier ?? VERIFIER,
    );
    state = out.context.currentQueryContext.state as LedgerState;
    return out.result;
  };

  // `grounds` takes raw bytes as well as a string so that a test can reach the
  // circuit's guard directly. Going through `encodeGrounds` would never get
  // there: it refuses the blank first, which proves the TypeScript guard and
  // says nothing about the one written into the proof.
  const respond = (
    kase: Uint8Array,
    kind: ResponseKind = ResponseKind.investigation,
    grounds: string | Uint8Array = 'Grounds stated in public.',
    opts: { detail?: string; secret?: Uint8Array } = {},
  ) => {
    const ctx = createCircuitContext(
      addr, COIN_PK, state, createAuthorityState(opts.secret ?? AUTHORITY),
    );
    const encoded = typeof grounds === 'string' ? encodeGrounds(grounds) : grounds;
    state = contract.circuits.respondToCase(ctx, kase, kind, encoded, opts.detail ?? '')
      .context.currentQueryContext.state as LedgerState;
  };

  for (const kase of admitted) admit(kase);

  return {
    contract,
    addr,
    admit,
    file,
    present,
    respond,
    l: () => ledger(state),
    raw: () => state,
  };
}

/** Drives a case over the review threshold with three distinct reporters. */
function escalate(e: ReturnType<typeof setup>, kase: Uint8Array): void {
  for (const who of [SOFIA, OTHER, THIRD]) e.file(who, kase);
}

type Env = ReturnType<typeof setup>;

// ── Registry ─────────────────────────────────────────────────────────────────

test('1. initial state: authority committed, registry empty', () => {
  const e = setup([]);
  const l = e.l();

  assert.equal(l.admittedCount, 0n);
  assert.equal(l.admittedIndex.isEmpty(), true);
  assert.equal(l.spentFilingNullifiers.isEmpty(), true);
  assert.equal(l.caseReports.isEmpty(), true);
  assert.equal(l.casesUnderReview.isEmpty(), true);
  assert.deepEqual(l.authorityCommitment, pureCircuits.authorityDigest(AUTHORITY));
});

test('2. admitCase: the case enters the registry and the aggregate reflects it', () => {
  const e = setup([]);
  e.admit(CASE_A);

  const l = e.l();
  assert.equal(l.admittedCount, 1n);
  assert.equal(l.admittedIndex.member(CASE_A), true);
  assert.equal(l.admittedIndex.member(CASE_B), false);
  assert.notEqual(l.admittedCases.root().field, 0n, 'the tree advanced');
});

test('3. ADVERSARIAL: a secret that is not the committed one cannot admit', () => {
  const e = setup([]);
  assert.throws(() => e.admit(CASE_A, IMPOSTOR), /Unrecognized authority/);
  assert.equal(e.l().admittedCount, 0n, 'nothing was written');
});

test('4. the same case cannot be admitted twice', () => {
  const e = setup([CASE_A]);
  assert.throws(() => e.admit(CASE_A), /Case already admitted/);
  assert.equal(e.l().admittedCount, 1n);
});

// ── Filing ───────────────────────────────────────────────────────────────────

test('5. happy path: a filing against an admitted case is accepted', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);

  const l = e.l();
  assert.equal(l.spentFilingNullifiers.size(), 1n);
  assert.equal(
    l.spentFilingNullifiers.member(pureCircuits.filingNullifierOf(SOFIA, CASE_A)),
    true,
  );
  assert.equal(l.caseReports.lookup(CASE_A).read(), 1n);
});

test('6. ADVERSARIAL: a case that was never admitted cannot be filed against', () => {
  const e = setup();
  assert.throws(() => e.file(SOFIA, NEVER_ADMITTED), /not in the admitted registry/);
  assert.equal(e.l().spentFilingNullifiers.isEmpty(), true);
});

test('7. the same reporter cannot file twice for the same case', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  assert.throws(() => e.file(SOFIA, CASE_A), /already filed for this case/);
  assert.equal(e.l().caseReports.lookup(CASE_A).read(), 1n, 'the count did not move');
});

test('8. nullifiers are bound to the (reporter, case) pair', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(OTHER, CASE_A); // different reporter, same case: allowed
  e.file(SOFIA, CASE_B); // same reporter, different case: allowed

  const l = e.l();
  assert.equal(l.spentFilingNullifiers.size(), 3n);
  assert.equal(l.caseReports.lookup(CASE_A).read(), 2n);
  assert.equal(l.caseReports.lookup(CASE_B).read(), 1n);
});

// ── Credential ───────────────────────────────────────────────────────────────

test('9. credential: three real filings produce a valid proof', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(SOFIA, CASE_B);
  e.file(SOFIA, CASE_C);

  assert.equal(e.present(SOFIA, [CASE_A, CASE_B, CASE_C]), true);
  assert.equal(e.l().spentPresentationNullifiers.size(), 1n, 'the context was spent');
});

test('10. ADVERSARIAL: zero filings cannot produce a credential', () => {
  const e = setup();
  // Nothing filed. There is no leaf to build a path to, so the client cannot
  // even assemble the inputs — which is the first half of the guarantee.
  const tree = e.l().filingNullifierTree;
  for (const kase of [CASE_A, CASE_B, CASE_C]) {
    assert.equal(
      tree.findPathForLeaf(pureCircuits.filingNullifierOf(SOFIA, kase)),
      undefined,
      'no path exists for a filing that was never made',
    );
  }

  // The second half: a reporter who builds their OWN tree, inserts nullifiers
  // they can legitimately derive, and presents paths into it. Every leaf and
  // path assert passes. `checkRoot` is what rejects it.
  const forged = createMerkleMirror();
  const paths: LeafPath[] = [];
  for (const kase of [CASE_A, CASE_B, CASE_C]) {
    forged.insert(pureCircuits.filingNullifierOf(SOFIA, kase));
  }
  for (const kase of [CASE_A, CASE_B, CASE_C]) {
    paths.push(forged.pathFor(pureCircuits.filingNullifierOf(SOFIA, kase)) as LeafPath);
  }

  assert.throws(
    () => e.present(SOFIA, [CASE_A, CASE_B, CASE_C], { root: forged.root(), paths }),
    /not a root of the on-chain nullifier tree/,
  );
});

test('11. ADVERSARIAL: one filing cannot be presented three times', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  assert.throws(
    () => e.present(SOFIA, [CASE_A, CASE_A, CASE_A]),
    /must be distinct/,
  );
});

test('12. ADVERSARIAL: you cannot present another reporter’s filings', () => {
  const e = setup();
  e.file(OTHER, CASE_A);
  e.file(OTHER, CASE_B);
  e.file(OTHER, CASE_C);

  // The paths exist — they are OTHER's — but the leaves do not match the
  // nullifiers SOFIA's secret derives.
  const tree = e.l().filingNullifierTree;
  const paths = [CASE_A, CASE_B, CASE_C].map(
    (c) => tree.findPathForLeaf(pureCircuits.filingNullifierOf(OTHER, c)) as unknown as LeafPath,
  );

  assert.throws(
    () => e.present(SOFIA, [CASE_A, CASE_B, CASE_C], { paths }),
    /not a nullifier of the caller/,
  );
});

test('13. a rejected presentation does not burn the verifier context', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(SOFIA, CASE_B);

  // Two filings: below the bar, so the third path cannot be built.
  const tree = e.l().filingNullifierTree;
  assert.equal(
    tree.findPathForLeaf(pureCircuits.filingNullifierOf(SOFIA, CASE_C)),
    undefined,
  );

  // A rejected attempt with a forged third leaf must not consume the context.
  const forged = createMerkleMirror();
  for (const kase of [CASE_A, CASE_B, CASE_C]) {
    forged.insert(pureCircuits.filingNullifierOf(SOFIA, kase));
  }
  const paths = [CASE_A, CASE_B, CASE_C].map(
    (c) => forged.pathFor(pureCircuits.filingNullifierOf(SOFIA, c)) as LeafPath,
  );
  assert.throws(
    () => e.present(SOFIA, [CASE_A, CASE_B, CASE_C], { root: forged.root(), paths }),
    /not a root of the on-chain nullifier tree/,
  );
  assert.equal(e.l().spentPresentationNullifiers.isEmpty(), true, 'context intact');

  // The reporter files the third case and the same context now works.
  e.file(SOFIA, CASE_C);
  assert.equal(e.present(SOFIA, [CASE_A, CASE_B, CASE_C]), true);
});

test('14. one credential per verifier context, and contexts are independent', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(SOFIA, CASE_B);
  e.file(SOFIA, CASE_C);

  assert.equal(e.present(SOFIA, [CASE_A, CASE_B, CASE_C]), true);
  assert.throws(
    () => e.present(SOFIA, [CASE_A, CASE_B, CASE_C]),
    /already presented in this context/,
  );
  assert.equal(
    e.present(SOFIA, [CASE_A, CASE_B, CASE_C], { verifier: OTHER_VERIFIER }),
    true,
    'a different verifier is a different context',
  );
});

// ── Output B ─────────────────────────────────────────────────────────────────

test('15. output B: per-case counter and the under-review flag', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  assert.equal(e.l().casesUnderReview.member(CASE_A), false, 'one is below the bar');

  e.file(OTHER, CASE_A);
  assert.equal(e.l().casesUnderReview.member(CASE_A), false, 'two is below the bar');

  e.file(THIRD, CASE_A);
  const l = e.l();
  assert.equal(l.caseReports.lookup(CASE_A).read(), 3n);
  assert.equal(l.casesUnderReview.member(CASE_A), true, 'three flips it');
  assert.equal(l.casesUnderReview.member(CASE_B), false, 'other cases unaffected');
});

// ── Witness trust ────────────────────────────────────────────────────────────

test('16. ADVERSARIAL: a prover that answers with a different secret each time', () => {
  // Every other case assumes an honest witness, which is an assumption about
  // the attacker. This one drops it: the witness runs on the prover's machine
  // and each `subjectSecret()` call is an independent private input.
  const secrets = [SOFIA, OTHER, THIRD, SOFIA];
  let reads = 0;
  const rotating: Witnesses<AmparoPrivateState> = {
    ...witnesses,
    subjectSecret: (c: WitnessContext<Ledger, AmparoPrivateState>) => [
      c.privateState,
      secrets[reads++ % secrets.length] as Uint8Array,
    ],
  };

  const e = setup([CASE_A, CASE_B, CASE_C], THRESHOLD, rotating);
  // Three people file one case each.
  reads = 0; e.file(SOFIA, CASE_A);
  reads = 1; e.file(OTHER, CASE_B);
  reads = 2; e.file(THIRD, CASE_C);

  // Pooling them into one "I filed three times" credential must fail: the
  // circuit reads the secret ONCE, so all three leaves are checked against the
  // same value and only one of them can match.
  reads = 0;
  const tree = e.l().filingNullifierTree;
  const paths = [
    tree.findPathForLeaf(pureCircuits.filingNullifierOf(SOFIA, CASE_A)),
    tree.findPathForLeaf(pureCircuits.filingNullifierOf(OTHER, CASE_B)),
    tree.findPathForLeaf(pureCircuits.filingNullifierOf(THIRD, CASE_C)),
  ] as unknown as LeafPath[];

  assert.throws(
    () => e.present(SOFIA, [CASE_A, CASE_B, CASE_C], { paths }),
    /not a nullifier of the caller/,
    'three people cannot pool one filing each',
  );
});

test('17. neither secret ever appears in public state', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);

  const l = e.l();
  const publicBytes: string[] = [toHex(l.authorityCommitment)];
  for (const n of l.spentFilingNullifiers) publicBytes.push(toHex(n));
  for (const c of l.admittedIndex) publicBytes.push(toHex(c));

  assert.ok(publicBytes.length >= 3, 'there is public state to inspect');
  for (const secret of [AUTHORITY, SOFIA]) {
    assert.equal(
      publicBytes.includes(toHex(secret)),
      false,
      `a secret leaked into public state`,
    );
  }
});

test('18. KNOWN LIMITATION: output B counts secrets, not people', () => {
  // One person with three invented secrets moves a case to review on their own.
  // Asserted rather than commented so it cannot quietly become a claim we do
  // not have. Sybil resistance needs an identity anchor the contract lacks.
  const e = setup();
  const sockpuppets = [b32(0xf1), b32(0xf2), b32(0xf3)];
  for (const s of sockpuppets) e.file(s, CASE_A);

  assert.equal(e.l().casesUnderReview.member(CASE_A), true, 'the gap is real');
});

test('19. the private state carries one role, and the other is named', () => {
  const e = setup();

  // The state is a union, so a state carrying BOTH secrets does not typecheck.
  // Before the contracts merged that was guaranteed by them being two types in
  // two files; merging them into one optional record gave it away silently.
  // Asserted at runtime too, because the union is only as good as the
  // constructors: neither builder can produce the other role's field.
  assert.equal('subjectSecret' in createAuthorityState(AUTHORITY), false);
  assert.equal('authoritySecret' in createSubjectState(SOFIA), false);

  // A reporter cannot admit: their private state has no authority secret, and
  // the failure says which role is missing rather than producing a proof of a
  // false statement.
  const ctx = createCircuitContext(e.addr, COIN_PK, e.raw(), createSubjectState(SOFIA));
  assert.throws(
    () => e.contract.circuits.admitCase(ctx, NEVER_ADMITTED),
    /needs the authority's secret/,
  );

  // And an authority cannot file.
  const ctx2 = createCircuitContext(e.addr, COIN_PK, e.raw(), createAuthorityState(AUTHORITY));
  assert.throws(
    () => e.contract.circuits.registerFiling(ctx2, CASE_A),
    /needs the reporter's secret/,
  );
});

// ── What unification changed ─────────────────────────────────────────────────

test('20. HISTORIC GUARANTEE: an old root is still accepted after later filings', () => {
  const e = setup();
  e.file(SOFIA, CASE_A);
  const rootAfterFirst = e.l().filingNullifierTree.root();

  e.file(OTHER, CASE_B);
  e.file(THIRD, CASE_C);

  assert.notEqual(e.l().filingNullifierTree.root().field, rootAfterFirst.field, 'it moved');
  assert.equal(
    e.l().filingNullifierTree.checkRoot(rootAfterFirst),
    true,
    'the older root is still accepted, so an in-flight proof stays valid',
  );
});

test('21. THE POINT: a case admitted late is filable immediately', () => {
  // This is the failure the split contracts had and could not fix. The filing
  // side received the admitted root as a constructor argument and froze it, so
  // a case admitted after deployment was permanently unfilable — and said so
  // with "Case is not in the admitted registry", which reads like the case is
  // unknown rather than newer.
  const e = setup([CASE_A]);
  e.file(SOFIA, CASE_A);
  e.file(OTHER, CASE_A);

  const LATE = b32(0x44);
  e.admit(LATE);

  // Immediately filable, with filings already on record and the registry root
  // long since moved.
  e.file(SOFIA, LATE);
  assert.equal(e.l().caseReports.lookup(LATE).read(), 1n);

  // And the older case still works, so nothing was traded away for it.
  e.file(THIRD, CASE_A);
  assert.equal(e.l().caseReports.lookup(CASE_A).read(), 3n);
  assert.equal(e.l().casesUnderReview.member(CASE_A), true);
});

test('22. THE POINT: no input to admitCase can influence the registry root', () => {
  // Replaces the old mirror-guard case. `admitCase` used to take `newRoot`, an
  // unconstrained parameter the authority could set to anything, guarded only
  // by an off-chain comparison. The parameter is gone, so the attack surface is
  // deleted rather than defended — there is no red case to write against an
  // input that does not exist. What is left to assert is the invariant that
  // replaced it: the root is a function of the admissions alone.
  const a = setup([]);
  const b = setup([]);

  for (const kase of [CASE_A, CASE_B, CASE_C]) {
    a.admit(kase);
    b.admit(kase);
  }
  assert.equal(
    a.l().admittedCases.root().field,
    b.l().admittedCases.root().field,
    'same admissions, same root, deterministically',
  );

  // Insertion order is part of it: a different order is a different tree, which
  // is why any client mirroring this has to replay in order.
  const c = setup([]);
  for (const kase of [CASE_C, CASE_B, CASE_A]) c.admit(kase);
  assert.notEqual(
    c.l().admittedCases.root().field,
    a.l().admittedCases.root().field,
    'order matters',
  );

  // The registry only ever grows through the gate.
  assert.equal(a.l().admittedCount, 3n);
});

// ── Response ─────────────────────────────────────────────────────────────────

test('23. happy path: an escalated case can be answered, on the record', () => {
  const e = setup();
  escalate(e, CASE_A);

  assert.equal(e.l().caseResponses.member(CASE_A), false, 'no answer yet');
  e.respond(CASE_A, ResponseKind.investigation, 'Opened case file 41/2026.', {
    detail: 'Three independent reports describe the same discharge point.',
  });

  const recorded = e.l().caseResponses.lookup(CASE_A);
  assert.equal(recorded.kind, ResponseKind.investigation);
  assert.equal(
    decodeGrounds(recorded.grounds),
    'Opened case file 41/2026.',
    'the grounds are on chain verbatim',
  );
  assert.equal(
    recorded.detail,
    'Three independent reports describe the same discharge point.',
    'and so is the unbounded half',
  );
});

test('24. ADVERSARIAL: a case below the threshold cannot be answered', () => {
  // The guard that matters most. Without it the control body dismisses a case
  // at one filing, and the public record then shows a prompt answer to an
  // escalation nobody ever saw happen — the appearance of oversight, produced
  // by acting before anyone was watching.
  const e = setup();
  e.file(SOFIA, CASE_A);
  e.file(OTHER, CASE_A); // two: one short of the bar

  assert.equal(e.l().casesUnderReview.member(CASE_A), false);
  assert.throws(
    () => e.respond(CASE_A, ResponseKind.dismissal, 'Nothing to see here.'),
    /has not reached the review threshold/,
  );
  assert.equal(e.l().caseResponses.isEmpty(), true, 'nothing was written');

  // The third filing escalates it, and the same answer is now recordable.
  e.file(THIRD, CASE_A);
  e.respond(CASE_A, ResponseKind.dismissal, 'Nothing to see here.');
  assert.equal(e.l().caseResponses.member(CASE_A), true);
});

test('25. ADVERSARIAL: an impostor cannot answer', () => {
  const e = setup();
  escalate(e, CASE_A);

  assert.throws(
    () => e.respond(CASE_A, ResponseKind.dismissal, 'Signed, nobody.', { secret: IMPOSTOR }),
    /Unrecognized authority/,
  );
  assert.equal(e.l().caseResponses.isEmpty(), true, 'nothing was written');
});

test('26. an answer is written once and never rewritten', () => {
  const e = setup();
  escalate(e, CASE_A);
  e.respond(CASE_A, ResponseKind.dismissal, 'Insufficient grounds.');

  assert.throws(
    () => e.respond(CASE_A, ResponseKind.investigation, 'On reflection, opening it.'),
    /already has a recorded response/,
  );

  const recorded = e.l().caseResponses.lookup(CASE_A);
  assert.equal(recorded.kind, ResponseKind.dismissal, 'the first answer stands');
  assert.equal(decodeGrounds(recorded.grounds), 'Insufficient grounds.');
});

test('27. THE OBSERVABLE: silence is publicly legible', () => {
  // The point of the whole circuit, asserted as the thing a client computes.
  // Nothing here needs a secret: the backlog is derivable by anyone with the
  // public state, which is what makes inaction impossible to deny.
  const e = setup();
  escalate(e, CASE_A);
  escalate(e, CASE_B);
  e.respond(CASE_B, ResponseKind.referral, 'Referred to the labour inspectorate.');

  const l = e.l();
  const unanswered = [...l.casesUnderReview].filter((k) => !l.caseResponses.member(k));

  assert.equal(l.casesUnderReview.size(), 2n);
  assert.equal(unanswered.length, 1, 'exactly one escalated case is unanswered');
  assert.equal(toHex(unanswered[0] as Uint8Array), toHex(CASE_A));
});

test('28. dismissal costs the same public record as any other answer', () => {
  // Dismissing is allowed on purpose. What is not allowed is dismissing
  // quietly: the record it leaves is the same size and shape as an
  // investigation, and it carries stated grounds either way.
  const e = setup();
  escalate(e, CASE_A);
  escalate(e, CASE_B);

  e.respond(CASE_A, ResponseKind.investigation, 'Grounds: converging reports.');
  e.respond(CASE_B, ResponseKind.dismissal, 'Grounds: outside our jurisdiction.');

  const l = e.l();
  const opened = l.caseResponses.lookup(CASE_A);
  const dropped = l.caseResponses.lookup(CASE_B);

  assert.equal(l.caseResponses.size(), 2n);
  assert.equal(dropped.kind, ResponseKind.dismissal);

  // Parity is the claim, so it is asserted as parity: the two records are the
  // same width and both carry their grounds back verbatim. The earlier version
  // of this test asserted that the dismissal's text was not empty - against a
  // literal this same test had just supplied, which no change to the contract
  // could ever have falsified. That the blank is impossible is a fact about the
  // circuit, and it is test 31's to prove.
  assert.equal(opened.grounds.length, GROUNDS_BYTES);
  assert.equal(dropped.grounds.length, GROUNDS_BYTES, 'same width on the ledger');
  assert.equal(decodeGrounds(dropped.grounds), 'Grounds: outside our jurisdiction.');
});

test('29. a reporter cannot answer', () => {
  const e = setup();
  escalate(e, CASE_A);

  const ctx = createCircuitContext(e.addr, COIN_PK, e.raw(), createSubjectState(SOFIA));
  assert.throws(
    () => e.contract.circuits.respondToCase(
      ctx, CASE_A, ResponseKind.dismissal, encodeGrounds('Not mine to make.'), '',
    ),
    /needs the authority's secret/,
  );
});

test('30. KNOWN LIMITATION: one answer per case, so a later change of mind has nowhere to go', () => {
  // Asserted rather than commented, for the same reason as 18: the permanence
  // that makes a dismissal costly also means an investigation that later closes
  // cannot be updated here. A body that changes its mind has to say so
  // somewhere this contract does not reach. Recording the sequence instead of
  // the verdict would need an append-only structure, which is a different
  // design and not the one on record.
  const e = setup();
  escalate(e, CASE_A);
  e.respond(CASE_A, ResponseKind.investigation, 'Opened.');

  assert.throws(
    () => e.respond(CASE_A, ResponseKind.dismissal, 'Closed after investigating.'),
    /already has a recorded response/,
  );
  assert.equal(
    e.l().caseResponses.lookup(CASE_A).kind,
    ResponseKind.investigation,
    'the chain still says "investigating" forever',
  );
});

test('31. ADVERSARIAL: an answer with no grounds is not an answer', () => {
  // The guard the whole split exists for. Every other check here is about
  // permission - who may write, and when. This one is about content, and
  // without it all of them are satisfiable by a blank: the body writes an
  // entry, the case stops reading as unanswered in test 27's backlog, and the
  // public record states nothing. Silence with a receipt.
  //
  // The bytes are built here rather than through `encodeGrounds`, on purpose.
  // That helper refuses the blank first, so routing this through it would prove
  // the TypeScript guard and leave the one compiled into the proof untested -
  // which is exactly the shape of an assertion that cannot fail.
  const e = setup();
  escalate(e, CASE_A);

  assert.throws(
    () => e.respond(CASE_A, ResponseKind.dismissal, new Uint8Array(GROUNDS_BYTES)),
    /must state its grounds/,
  );
  assert.equal(e.l().caseResponses.isEmpty(), true, 'nothing was written');

  // A detail field cannot stand in for it. `detail` is `Opaque<"string">`, which
  // has no literal in the circuit's language and so no value it can be compared
  // against: it is unconstrainable by construction, and that is the reason the
  // mandatory half had to be the fixed-width one.
  assert.throws(
    () => e.respond(CASE_A, ResponseKind.dismissal, new Uint8Array(GROUNDS_BYTES), {
      detail: 'The explanation lives here instead.',
    }),
    /must state its grounds/,
  );

  // And with grounds present the same answer goes through, so the guard is
  // rejecting the blank and not the call.
  e.respond(CASE_A, ResponseKind.dismissal, 'Outside our remit.');
  assert.equal(e.l().caseResponses.member(CASE_A), true);
});

test('32. grounds are measured in BYTES, and overflow is refused rather than cut', () => {
  // A budget in characters would be wrong in the language this is written for.
  // Every accented letter costs two bytes, so the same 200 characters fit or do
  // not depending on the prose.
  const accented = 'ó'.repeat(GROUNDS_BYTES / 2);
  assert.equal(accented.length, 128, 'well under 256 characters');
  assert.equal(encodeGrounds(accented).length, GROUNDS_BYTES, 'and exactly at the byte budget');
  assert.throws(() => encodeGrounds(accented + 'ó'), /must fit in 256 bytes/);

  // Truncating is the tempting alternative and it is the dangerous one: cutting
  // UTF-8 at a byte offset splits whatever character straddles it, and the entry
  // is permanent and unrewritable. Refusing is the last chance to not do that.
  const roundTripped = decodeGrounds(encodeGrounds(accented));
  assert.equal(roundTripped, accented, 'no character was harmed on the way through');

  // Whitespace-only would satisfy the circuit - it is not the zero padding - so
  // it is caught here, where the error can still say why.
  assert.throws(() => encodeGrounds('   '), /must not be empty/);
  assert.throws(() => encodeGrounds(''), /must not be empty/);

  // The padding is padding, not content: it must not come back as 256 NUL
  // characters that render as nothing and compare as something.
  assert.equal(decodeGrounds(encodeGrounds('Short.')), 'Short.');
  assert.equal(decodeGrounds(new Uint8Array(GROUNDS_BYTES)), '');
});

test('33. THE OBSERVABLE, as code a client can run: silence is derivable with no secret', () => {
  // Test 27 proves the fact exists in the state. This proves something else:
  // that a client can compute it. The state was written by the contract and
  // read by a test, and a guarantee whose only reader is its own test suite is
  // not one anybody can act on.
  //
  // The argument list is the assertion. `derivePublicView` takes the ledger and
  // a threshold - no secret, no reporter identity - which is what makes the
  // result evidence rather than a private dashboard.
  const e = setup();
  escalate(e, CASE_A);
  escalate(e, CASE_B);
  e.respond(CASE_B, ResponseKind.referral, 'Referred to the labour inspectorate.', {
    detail: 'Jurisdiction lies with the inspectorate under section 12.',
  });

  const view = derivePublicView(e.l(), 3n);

  assert.equal(view.underReviewCount, 2);
  assert.equal(view.unanswered.length, 1, 'one case was told and not answered');
  assert.equal(
    view.unanswered[0]!.caseCommitment,
    toHex(CASE_A),
    'and it is the one nobody answered',
  );

  // The answered one carries its text back through the padding, both halves.
  const answered = view.cases.find((c) => c.answered)!;
  assert.equal(answered.caseCommitment, toHex(CASE_B));
  assert.equal(answered.kind, ResponseKind.referral);
  assert.equal(answered.grounds, 'Referred to the labour inspectorate.');
  assert.equal(answered.detail, 'Jurisdiction lies with the inspectorate under section 12.');

  // And the unanswered one has no grounds KEY, not an empty one. Blank and
  // absent render identically and mean opposite things: one is a body that
  // said nothing, the other is a body that was never asked.
  const silent = view.unanswered[0]!;
  assert.equal('grounds' in silent, false, 'absence is absence, not an empty string');
  assert.equal(silent.reports >= 3n, true, 'it did cross the threshold');

  // A case admitted but never escalated is LISTED, but is not silence. This is
  // the distinction the merged view has to keep and a backlog-only view could
  // not: `unanswered` means the body owes an answer, and nobody is owed one on
  // a case no reporter has raised.
  const untouched = view.cases.find((c) => c.caseCommitment === toHex(CASE_C))!;
  assert.equal(untouched.underReview, false, 'never reported');
  assert.equal(untouched.answered, false, 'and so unanswered in the literal sense');
  assert.equal(
    view.unanswered.some((c) => c.caseCommitment === toHex(CASE_C)),
    false,
    'but nothing is owed on it, so it is not in the backlog',
  );
});

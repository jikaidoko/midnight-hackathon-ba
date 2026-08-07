// filing_registry.test.ts — step 1 of the filing registry, in the Compact
// runtime SIMULATOR. Deploy-free and prover-free: it runs circuit logic
// (asserts, state transitions) deterministically, without generating a ZK proof
// or touching testnet, DUST or a proof server.
//
// Run: `npm test` (tsx resolves the .js -> .ts imports of the generated code;
// plain `node --test` does not).
//
// Coverage, and why each case exists:
//   1. Initial state: nothing spent, deployed root matches the mirror.
//   2. Happy path: a filing against an admitted case.
//   3. ADVERSARIAL — a path for a case that was never admitted is rejected.
//      This is the security argument of the whole design, as an executable test:
//      the Merkle path is a witness value, so a subject can fabricate one; the
//      circuit re-derives the root and catches it.
//   4. A path whose leaf disagrees with the claimed case is rejected.
//   5. Nullifier: the same subject cannot file twice for the same case.
//   6. The nullifier is bound to the PAIR — different subjects may file the
//      same case, which is precisely what the public alarm needs.
//   7. Threshold credential: >= N is true at the bar and false below it, and
//      the real count never reaches public state.
//   8. Presentation nullifier: a threshold proof cannot be replayed in the same
//      verifier context.
//   9. The subject's secret never appears in public state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from './managed/filing_registry/contract/index.js';
import {
  witnesses,
  createSubjectPrivateState,
  type SubjectPrivateState,
} from './filing-witnesses.js';
import { createAdmittedRegistry, toHex, type AdmittedPath } from './admitted-paths.js';

const COIN_PK = '00'.repeat(32);
const b32 = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

const SOFIA_SECRET = b32(0x50);
const OTHER_SECRET = b32(0x60);

const CASE_A = b32(0x11);
const CASE_B = b32(0x22);
const NEVER_ADMITTED = b32(0x99);

const VERIFIER_CTX = b32(0x01);
const OTHER_VERIFIER_CTX = b32(0x02);

type LedgerState = CircuitContext<SubjectPrivateState>['currentQueryContext']['state'];

/** A deployed contract plus the off-chain mirror that produced its root. */
function setup(admittedCases: Uint8Array[] = [CASE_A, CASE_B]) {
  const registry = createAdmittedRegistry();
  for (const c of admittedCases) registry.admit(c);

  const contract = new Contract<SubjectPrivateState>(witnesses);
  const init = contract.initialState(
    createConstructorContext<SubjectPrivateState>(
      createSubjectPrivateState(SOFIA_SECRET),
      COIN_PK,
    ),
    registry.root(),
  );

  return {
    contract,
    registry,
    addr: dummyContractAddress(),
    state: init.currentContractState.data as LedgerState,
    priv: createSubjectPrivateState(SOFIA_SECRET),
  };
}

type Env = ReturnType<typeof setup>;

/** Runs `registerFiling`, threading both public and private state forward. */
function file(
  c: Env,
  state: LedgerState,
  priv: SubjectPrivateState,
  caseCommitment: Uint8Array,
  path: AdmittedPath,
): { state: LedgerState; priv: SubjectPrivateState } {
  const ctx = createCircuitContext<SubjectPrivateState>(c.addr, COIN_PK, state, priv);
  const out = c.contract.circuits.registerFiling(ctx, caseCommitment, path);
  return {
    state: out.context.currentQueryContext.state,
    priv: out.context.currentPrivateState,
  };
}

/** Runs `proveRepeatFilings` and returns the boolean plus the new state. */
function prove(
  c: Env,
  state: LedgerState,
  priv: SubjectPrivateState,
  threshold: bigint,
  verifierContext: Uint8Array,
): { result: boolean; state: LedgerState } {
  const ctx = createCircuitContext<SubjectPrivateState>(c.addr, COIN_PK, state, priv);
  const out = c.contract.circuits.proveRepeatFilings(ctx, threshold, verifierContext);
  return { result: out.result, state: out.context.currentQueryContext.state };
}

test('1. initial state: nothing spent and the deployed root matches the mirror', () => {
  const c = setup();
  const l = ledger(c.state);

  assert.equal(l.spentFilingNullifiers.size(), 0n, 'no filings yet');
  assert.equal(l.spentPresentationNullifiers.size(), 0n, 'no proofs presented yet');
  assert.equal(
    l.admittedRoot.field,
    c.registry.root().field,
    'the contract was deployed with the mirror root',
  );
});

test('2. happy path: a filing against an admitted case is accepted', () => {
  const c = setup();
  const r = file(c, c.state, c.priv, CASE_A, c.registry.pathFor(CASE_A));
  const l = ledger(r.state);

  assert.equal(l.spentFilingNullifiers.size(), 1n, 'one nullifier spent');
  assert.equal(r.priv.filingCount, 1n, 'the private count advanced');
});

test('3. ADVERSARIAL: a path for a case that was never admitted is rejected', () => {
  const c = setup();

  // The subject builds a path in their own tree — the circuit never saw it.
  // This is exactly the attack the design has to survive: the path is a witness
  // value, so nothing stops a subject from fabricating one.
  const rogue = createAdmittedRegistry();
  rogue.admit(NEVER_ADMITTED);

  assert.throws(
    () => file(c, c.state, c.priv, NEVER_ADMITTED, rogue.pathFor(NEVER_ADMITTED)),
    /not in the admitted registry/i,
    'a fabricated path must not produce a valid filing',
  );
});

test('4. a path whose leaf disagrees with the claimed case is rejected', () => {
  const c = setup();

  assert.throws(
    () => file(c, c.state, c.priv, CASE_A, c.registry.pathFor(CASE_B)),
    /leaf does not match/i,
    'the leaf must be the case being filed',
  );
});

test('5. nullifier: the same subject cannot file twice for the same case', () => {
  const c = setup();
  const first = file(c, c.state, c.priv, CASE_A, c.registry.pathFor(CASE_A));

  assert.throws(
    () => file(c, first.state, first.priv, CASE_A, c.registry.pathFor(CASE_A)),
    /already filed/i,
    'a second filing for the same case must be refused',
  );
});

test('6. the nullifier is bound to the (subject, case) pair, not just the case', () => {
  const c = setup();
  const mine = file(c, c.state, c.priv, CASE_A, c.registry.pathFor(CASE_A));

  // A different subject reports the same case. This must be allowed: it is what
  // makes independent corroboration — and the public alarm — possible.
  const otherPriv = createSubjectPrivateState(OTHER_SECRET);
  const theirs = file(c, mine.state, otherPriv, CASE_A, c.registry.pathFor(CASE_A));

  assert.equal(
    ledger(theirs.state).spentFilingNullifiers.size(),
    2n,
    'two distinct subjects produced two distinct nullifiers for one case',
  );
  assert.equal(theirs.priv.filingCount, 1n, 'the second subject counts their own filing');
});

test('7. threshold credential: true at the bar, false below it, count stays private', () => {
  const c = setup([CASE_A, CASE_B, b32(0x33)]);

  let s = c.state;
  let p = c.priv;
  for (const kase of [CASE_A, CASE_B, b32(0x33)]) {
    const r = file(c, s, p, kase, c.registry.pathFor(kase));
    s = r.state;
    p = r.priv;
  }
  assert.equal(p.filingCount, 3n, 'three filings accumulated privately');

  assert.equal(prove(c, s, p, 3n, VERIFIER_CTX).result, true, '3 >= 3');
  assert.equal(prove(c, s, p, 4n, OTHER_VERIFIER_CTX).result, false, '3 >= 4 is false');

  // The real count is nowhere in public state — only the boolean crossed over.
  const publicDump = JSON.stringify(ledger(s), (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  assert.ok(!publicDump.includes('"3"'), 'the real filing count never reaches the ledger');
});

test('8. presentation nullifier: a proof cannot be replayed in the same context', () => {
  const c = setup();
  const r = file(c, c.state, c.priv, CASE_A, c.registry.pathFor(CASE_A));

  const first = prove(c, r.state, r.priv, 1n, VERIFIER_CTX);
  assert.equal(first.result, true, '1 >= 1');

  assert.throws(
    () => prove(c, first.state, r.priv, 1n, VERIFIER_CTX),
    /already presented/i,
    'the same verifier context must not accept the proof twice',
  );

  // A different verifier is a different context, so it is still allowed.
  assert.equal(
    prove(c, first.state, r.priv, 1n, OTHER_VERIFIER_CTX).result,
    true,
    'a different context is a fresh presentation',
  );
});

test('9. the subject secret never appears in public state', () => {
  const c = setup();
  const r = file(c, c.state, c.priv, CASE_A, c.registry.pathFor(CASE_A));

  const publicDump = JSON.stringify(ledger(r.state), (_k, v) =>
    v instanceof Uint8Array ? toHex(v) : typeof v === 'bigint' ? v.toString() : v,
  );

  assert.ok(
    !publicDump.includes(toHex(SOFIA_SECRET)),
    'the secret must not be recoverable from the ledger',
  );
  assert.equal(r.priv.subjectSecret, SOFIA_SECRET, 'it stays in private state');
});

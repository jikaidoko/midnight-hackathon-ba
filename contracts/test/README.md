# Tests

Three layers, each answering a different question. Run them all with
`npm test` from `contracts/`.

| Layer | Where | Question it answers |
|---|---|---|
| **Unit** | `src/*.test.ts` | Does each circuit enforce its own rules? |
| **Adversarial** | inside the unit files, marked `ADVERSARIAL` | Can a malicious client get away with it? |
| **End to end** | `test/e2e/` | Does the product journey actually work, start to finish? |

Everything runs in the Compact **simulator**: circuit logic executes
deterministically with no ZK proof generated, no testnet, no DUST and no proof
server. That is what makes the suite a sub-two-second loop instead of a
multi-minute one. It also means the suite does **not** exercise proving,
transaction submission or finality — see "Not covered".

## Why the adversarial tests matter most

A zero-knowledge proof certifies that a circuit ran correctly over *some*
witness. It does not certify that the witness was true, and proving is
client-side by design, so the attacker owns that file. Every claim this product
makes therefore has to be anchored in public state, and the adversarial tests
are where we check that it is.

They are written as attacks, not as happy paths phrased negatively:

- `amparo` test 10 — a reporter with **zero filings on chain** tries to produce
  a credential, first by finding there is no path to build, then with Merkle
  paths into a tree they built themselves. `checkRoot` rejects it in-circuit.
- `amparo` test 12 — a reporter presents someone else's filings.
- `amparo` test 16 — a prover whose witness answers with a **different secret on
  each read**. Every other case assumes an honest witness, which is an
  assumption about the attacker; this one drops it.
- `amparo` test 6 — a filing against a case the authority never admitted.
- `amparo` test 3 — an impostor secret tries to admit a case.

If one of these ever goes green in the wrong direction, the product claim is
gone, not just a feature.

## Known gaps, asserted on purpose

Two limitations are real and are encoded as **passing tests that assert the
gap**, so they cannot quietly turn into claims we have not earned:

- `amparo` test 18 — `subjectSecret` is unanchored, so the public per-case
  counter counts distinct **secrets**, not distinct **people**. One actor with
  three invented secrets trips the under-review flag. Anchoring identity is the
  next step, and it is the one gap that still limits what output B can claim.

The second gap on this list is gone. It read: the two contracts are not merged,
so the filing side freezes the admitted root at construction and a case admitted
afterwards can never be filed against. `amparo` test 21 and step 7 of the
journey now assert the opposite — a late case is filable immediately.

## Not covered

Honest list, so nobody assumes otherwise:

- Proof generation and verification (simulator only).
- Transaction submission, fees, DUST, finality.
- The off-chain verifier guard is exercised in tests, but nothing forces a real
  verifier to call it. That obligation lives in `src/verifier.ts` and has to be
  honoured by whoever integrates.
- Mirror resynchronisation after a failed on-chain write. The nullifier tree
  avoids this by reading paths from the ledger; the case registry does not.
- Frontend and wallet integration.

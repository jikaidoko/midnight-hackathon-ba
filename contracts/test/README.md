# Tests

Four layers, each answering a different question. `npm test` from `contracts/`
runs the first three; the fourth needs a chain.

| Layer | Where | Question it answers |
|---|---|---|
| **Unit** | `src/amparo.test.ts` (circuits, in the simulator) and `src/midnight/*.test.ts` (the TypeScript layer) | Does each circuit enforce its own rules, and does the client layer read them correctly? |
| **Adversarial** | inside the unit files, marked `ADVERSARIAL` | Can a malicious client get away with it? |
| **End to end** | `test/e2e/` | Does the product journey actually work, start to finish? |
| **On chain** | `test/on-chain-run.md` | Do the proofs generate, submit, and get rejected for real? |

The first three run in the Compact **simulator**: circuit logic executes
deterministically with no ZK proof generated, no testnet, no DUST and no proof
server. That is what makes the suite a sub-two-second loop instead of a
multi-minute one, and it is why they are the loop you work in.

What the simulator cannot tell you is whether any of it survives contact with a
chain. That is the fourth layer, and it is a **recorded run** rather than an
automated one: `on-chain-run.md` documents a full journey against a local
standalone network with real proofs, including the presentation that had to be
rejected and was. It is deliberately not part of `npm test` — it needs Docker, a
synced wallet and minutes rather than seconds, and a suite that cannot run
offline is a suite people stop running.

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
- `amparo` test 30 — a response is written once and never rewritten, so a body
  that opens an investigation and later closes it has nowhere on chain to say so.
  The permanence that makes a dismissal costly is the same permanence that
  freezes a verdict. Recording the sequence instead of the verdict needs an
  append-only structure, which is a different design.

The second gap on this list is gone. It read: the two contracts are not merged,
so the filing side freezes the admitted root at construction and a case admitted
afterwards can never be filed against. `amparo` test 21 and step 7 of the
journey now assert the opposite — a late case is filable immediately.

## Not covered

Honest list, so nobody assumes otherwise:

- **A public network.** The on-chain run used a local standalone chain: pre-funded
  genesis wallet, no faucet, no fee pressure, no contention, nobody else writing.
  Timing and failure modes on a public network are not evidenced anywhere here.
- **The browser.** Every on-chain step ran through the Node scripts in
  `contracts/scripts/`. The interface assembles its transactions through a
  different provider set, so a passing script says nothing about it.
- The off-chain verifier guard is exercised in tests, but nothing forces a real
  verifier to call it. That obligation lives in `src/verifier.ts` and has to be
  honoured by whoever integrates.
- Mirror resynchronisation after a failed on-chain write. The nullifier tree
  avoids this by reading paths from the ledger; the case registry does not.

Two entries left this list and are now covered by `on-chain-run.md`: proof
generation and verification, and transaction submission and finality. They are
listed there with transaction ids rather than deleted, because "covered" for
that layer means *one recorded run*, not a check that repeats on every commit.

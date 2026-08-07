# On-chain run — 7 August 2026

A record of one run of the full product journey against a **running chain**,
with real zero-knowledge proofs. Everything else in this directory executes in
the simulator; this is the layer that answers whether the proofs actually
generate, the transactions actually submit, and the circuits reject on chain
what they reject in the simulator.

**This file is a dated record, not a status.** It says what happened on one
chain at one moment, against one contract address. It does not become false when
the chain is torn down — it stops describing anything that exists, which is a
different thing, and worth keeping in mind before reading it as a claim about
today. Re-running it means new addresses and new transaction ids.

## Environment

| | |
|---|---|
| Network | `undeployed` — local standalone, `docker-compose.midnight.yml` |
| Node | `midnightntwrk/midnight-node:0.22.3` |
| Indexer | `midnightntwrk/indexer-standalone:4.0.1` |
| Proof server | `midnightntwrk/proof-server:8.0.3` |
| `compactc` | 0.31.0 |
| Node.js | 22.17.0 |
| Simulator suite at the time | **41/41 passing**, typecheck clean |

Contract deployed at:

```
c5f3b2e414752f33e1754e19e6ea06cc991cecb01fe51e149c1def4bd59b9cf0
```

`reviewThreshold` = 3, sealed at construction. Three case commitments were used,
chosen to be readable rather than realistic: `a1a1…`, `b2b2…`, `c3c3…`.

## What ran, and what each step proves

Every row below generated a proof client-side and submitted a transaction. The
right-hand column names the simulator test that asserts the same rule, so the
two layers can be read against each other.

| # | Step | Result | Simulator counterpart |
|---|---|---|---|
| 0 | `deploy` — constructor proof | contract address above | — |
| 1 | `admitCase` `a1a1…` | admitted count 1 | test 2 |
| 2 | `admitCase` `b2b2…` | admitted count 2 | test 2 |
| 3 | `admitCase` `c3c3…` | admitted count 3 | test 2 |
| 4 | `registerFiling` `a1a1…` | reports 1, not under review | test 5 |
| 5 | `registerFiling` `b2b2…` | reports 1, not under review | test 5 |
| 6 | `registerFiling` `c3c3…` | reports 1, not under review | test 5 |
| 7 | `proveRepeatFilings` → `ministerio-de-trabajo` | **accepted**, 3/3 paths found | test 9 |
| 8 | `proveRepeatFilings` → `ministerio-de-trabajo` again | **rejected in-circuit** | test 14 |
| 9 | `proveRepeatFilings` → `defensoria-del-pueblo` | **accepted** | test 14 |

Transaction ids:

```
admitCase          0094e11b48c951ccdd805b075592f9a05fb176dc7363c99238e72b19e2f87171ea
                   00b99cbef10ef962357fef04b41c62a6c75dec53cf5e4d4f2268a90c09a019ac68
                   0034fa5dea5dc1a2e709b88f7c704355ad4fed6c1ba0feccfe7ecd9e151d5f8a97
registerFiling     0090e3e4319eafba6343c3811988ee4ba352328faa18cc55dd81665e3f946d95e5
                   00a9dce5d6963ba179fc1f95134a98a850d0d8e77d8d7c718f49972d3cb6e2ed0c
                   00c654f8def2669f6c2fc387327b99fb2ebca779cd114714c940a509578d865766
proveRepeatFilings 0087f59856420b7a635e5e2a41c9e1e392592ed495dc4a7e60e88d2fe5a1c61dbe
                   0005b53a7e7136fe930a98b2e41e8a5062e27896be1e8a6d898cdfc4a3cea85b9c
```

## Step 8 is the one that proves something

Steps 1 through 7 are a happy path, and a happy path on chain mostly proves the
plumbing works. **Step 8 is the run that had to fail, and did**, with the
circuit's own message:

```
failed assert: Threshold proof already presented in this context
```

That is the replay guard rejecting a second presentation to the same verifier,
on chain, after a proof was generated for it. Step 9 then presented the same
credential to a *different* verifier and was accepted — which is what separates
"the guard works" from "the guard rejects everything after the first time".

Running only step 7 would have produced the same green output and proved neither.
A single accepted presentation is consistent with a replay guard that does not
exist at all.

## Three cases, three filings, one reporter, and nothing linking them

Worth stating explicitly, because it is the product claim: after step 6 the
chain holds three filings whose nullifiers all derive from one reporter's
secret, and **nothing on chain connects the three to each other or to anybody**.
Step 7 then proved they belong to one person without naming any of them. The
per-case counters stayed at 1 each, so none crossed the threshold — the review
flag is driven by *distinct reporters converging on one case*, which is a
different scenario and is covered in the simulator by test 15.

## What this run still does not cover

The suite's `README.md` lists what the simulator cannot reach. This run closes
three of those and leaves the rest open:

- **Closed** — proof generation and verification, transaction submission, and
  finality, for all four circuits.
- **Still open** — a public network. This ran against a local standalone chain
  with a pre-funded genesis wallet: no faucet, no fee pressure, no contention,
  and a chain nobody else is writing to. Timing and failure modes on a public
  network are not evidenced here.
- **Still open** — the browser. Every step above ran through the Node scripts in
  `contracts/scripts/`. The interface builds its transactions through a
  different provider set, and a passing script says nothing about it.
- **Still open** — the identity gap. Test 18 asserts it, and it is unchanged:
  the reporter's secret is not anchored to a person, so the public counter counts
  distinct secrets. Running on a real chain does not move that.
- **Still open** — mirror resynchronisation after a failed write, as before.

## Reproducing it

From `contracts/`, in this order — each step rules out a different failure, and
skipping to the deploy means reading a balancing error to discover the indexer
was still starting:

```bash
npm run mn:up            # start the local chain
npm run mn:health        # all three services, probed from the host
npm run check-wallet     # this seed builds a wallet that syncs
npm run deploy           # first step that generates a proof

npm run admit-case    -- <64 hex>
npm run file-report   -- <64 hex> --subject sofia
npm run prove-credential -- --subject sofia --context "some-verifier"
npm run prove-credential -- --subject sofia --context "some-verifier"   # must FAIL
npm run prove-credential -- --subject sofia --context "another-verifier" # must pass
```

The last two lines are the point. A run that stops at the first presentation has
not tested the replay guard.

### One thing that will bite

`.wallet-state/` is gitignored and machine-local, and a **fresh checkout or a
new worktree is a new machine as far as the wallet is concerned** — it will sync
from genesis rather than resume. On this local chain that costs seconds; against
a public network it is hours. Copy the directory across before deploying, or
budget for the full scan. `.zk-params/` has the same shape for a different
reason: it is a *relative* bind mount in the compose file, so bringing the stack
up from a different directory recreates the proof server against an empty cache
and re-downloads roughly 33 MB.

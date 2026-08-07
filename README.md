# Amparo - private whistleblowing channel

Midnight Hackathon Buenos Aires, August 7-8 2026.

Someone reports a case without revealing who they are, and the system can still
prove two things that today require exposing the reporter: that the case was
**admitted by a control authority**, and that this person **has already filed N
times** - without saying how many, which ones, or who.

## Layout

| Path | What it is |
|---|---|
| `contracts/` | Compact circuits and their TypeScript layer |
| `contracts/src/amparo.compact` | The contract: case admission, filings, threshold credential, public case alarm |
| `contracts/src/amparo-witnesses.ts` | Private inputs the circuits read |
| `contracts/src/merkle-mirror.ts` | Merkle mirror, used by the adversarial tests to build a forged tree |
| `contracts/src/verifier.ts` | Off-chain second source for a presented root |
| `contracts/src/midnight/` | Network configuration, wallet, providers, contract descriptors |
| `contracts/scripts/` | Health check, wallet check, deploy, admit, file, present |
| `contracts/src/*.test.ts` | Simulator tests (no proof server) |
| `contracts/test/` | End-to-end product journey and the test strategy |
| `contracts/docker-compose.midnight.yml` | Local standalone network |

One contract. It has been exercised against a running chain with real proofs,
not only in the simulator: admission, filing, corroboration crossing the review
threshold, and a credential presented and then refused on replay.

## Toolchain

- `compactc` **0.31.0** / language **0.23.0**
- `@midnight-ntwrk/compact-runtime` **0.16.0**
- Node 22

The compiler runs under WSL; the tests run on native Windows Node.

## Running

```bash
cd contracts
npm install
npm run compile      # emits src/managed/ with prover/verifier keys
npm test             # simulator tests
npm run typecheck
```

`npm run compile:fast` skips ZK key generation (`--skip-zk`); use it for the fast
loop while iterating on the circuit.

**Recompile after every pull.** `src/managed/` is gitignored, so a pull that
changes a `.compact` source leaves your compiled contract behind and the tests
run against the old one. The failure is convincing: real assertions fail with
`Missing expected exception`, pointing at circuits that are in fact correct. If a
test that should pass is red and you have just pulled, run `npm run compile`
before reading anything else.

## Running against a network

Everything below works offline against a local chain. No testnet, no faucet: the
node boots with a pre-funded genesis wallet.

```bash
cd contracts
npm run mn:up          # start node, indexer and proof server
npm run mn:health      # confirm all three answer
npm run check-wallet   # confirm the wallet builds and syncs
npm run deploy         # deploy; generates the constructor proof. `-- 2` sets the
                       # review threshold; it defaults to 3 and is sealed after
                       # deployment, so this is the only place to choose it
npm run admit-case     # admit one case end to end
npm run mn:down        # stop, and DELETE the chain state
```

### The reporter path

Admit and file in any order. A case admitted after the contract was deployed, or
after other cases have already been filed against, is filable immediately:
`registerFiling` checks the live registry. Ordering used to be load-bearing while
these were two contracts - see below for what changed.

```bash
npm run admit-case -- <64 hex>                     # once per demo case
npm run file-report -- <64 hex> --subject sofia    # one report, one reporter
npm run prove-credential -- --subject sofia --context "ministry-of-labour"
```

`--subject` names the reporter. Each one gets their own secret and their own
private-state namespace, created on first use in `contracts/subjects.<network>.json`
- gitignored, because every filing derives from those secrets and nothing on
chain links a filing to anyone. That file is also where the client records which
cases a reporter filed against: the chain deliberately does not know, so without
it a credential can never be rebuilt. That is the privacy property working, not a
gap.

The threshold comes from the deployment record rather than the chain.
`reviewThreshold` is `sealed`, and a sealed field is absent from the generated
`Ledger` projection: the circuit reads it, no client can.

### There used to be two contracts, and it showed

Admission and filings were separate contracts, so the filing side received the
admitted root as a constructor argument and froze it. A case admitted after
deployment could never be filed against, and the error said `Case is not in the
admitted registry` - which reads like the case is unknown when it was merely
newer. Order of operations became load-bearing: admit first, deploy second.

They are one contract now. `registerFiling` checks the live registry, so a case
admitted one block ago is filable immediately. Nothing is frozen, so nothing
goes stale.

The merge also removed the Merkle path `registerFiling` used to take. The case is
necessarily disclosed - it is the key of the public counter - so a Set lookup on
an already-public value proves membership exactly, and does it against the live
registry instead of a frozen root.

**This saves proving cost, not privacy.** The split contract used
`assert(merkleTreePathRoot(path) == admittedRoot)`: a pure comparison, no ledger
operation, no `disclose`. The path never reached `declare_pub_input`, so removing
it cannot reduce a leak - privacy is byte-identical, because the only thing
protecting the reporter is `subjectSecret` disappearing into an opaque hash and
that never changed. What it buys is 40 fewer witness variables and no
client-side tree fetch before filing.

Configuration is entirely environmental, with defaults pointing at the local
network - copy `contracts/.env.example` to `contracts/.env` only when you need to
reach a public one. Shell variables take precedence over `.env`, so a single
command can be aimed elsewhere without editing a file that holds a seed:

```bash
MN_NETWORK=undeployed MN_NODE_URL=http://127.0.0.1:9944 npm run check-wallet
```

### Order matters, and each step rules out a different failure

`mn:health` says the services answer. `check-wallet` says this seed builds a
wallet that syncs. `deploy` is the first step that generates a proof, so it is
also the first that can fail for a reason that has nothing to do with your code.
Running them in order means a failure names its own cause; skipping to `deploy`
means reading a balancing error to find out the indexer was still starting.

### Health is checked from the host, not from `docker compose ps`

`docker compose ps` reports two healthy services, never three. The proof server
image is distroless - no shell, no HTTP client - so no healthcheck can execute
inside it, and it stays `Up` forever however well it is working. Waiting for a
third `healthy` never ends. `npm run mn:health` probes all three over HTTP from
the host, which is the check that can actually answer.

Add `-- --ws-seconds=30` before a live demo on a public network: it holds the
subscriptions open, which is the thing a wallet sync depends on and no HTTP check
observes. A socket that drops after a minute means a sync that never completes
while every other signal stays green.

### The first sync is the expensive one

A wallet with no saved state scans from genesis. On a public network that is
hours; the scripts say `syncing from genesis. This is the slow path` when they
are about to do it. After the first sync, state is saved to
`contracts/.wallet-state/` every 30 seconds and restored on the next start, so
later runs resume incrementally and take minutes.

That directory is gitignored and machine-local. Moving the deployment to another
machine means paying the first sync again, so plan it before it is on the
critical path, not the morning of.

## Decisions worth knowing before reading the code

- **The MerkleTree ADT's `root()` is runtime-only.** Verified against compactc
  0.31.0: `MerkleTree root is a runtime-only method, but was invoked in-circuit`.
  If a circuit needs to publish the new root, it has to arrive as a parameter.
- **The registry is a `HistoricMerkleTree`, not a `MerkleTree`.**
  `MerkleTree.checkRoot()` accepts only the current root, so every admission
  would invalidate the inclusion path of every already admitted case. The
  historic ADT accepts past roots.
- **A sealed ledger field is invisible to clients.** `reviewThreshold` is
  `sealed`, so the compiler forbids rewriting it - and it is absent from the
  generated `Ledger` projection entirely. The circuit reads it; no UI can.
  Whatever displays it has to carry it from the deployment record.
- **The WebAssembly packages must resolve to exactly one copy each.**
  `@midnight-ntwrk/ledger-v8` and `@midnight-ntwrk/onchain-runtime-v3` are pinned
  and overridden in `contracts/package.json` for that reason. Each carries its
  own wasm instance owning its own classes, so an object built by one copy fails
  the other's type check - `expected instance of LedgerParameters`, `expected
  instance of StateValue` - from inside a dependency, during a deployment.
  Neither the typecheck nor the simulator tests can see it, because neither ever
  builds a transaction. After any dependency change:

  ```bash
  npm ls @midnight-ntwrk/ledger-v8 @midnight-ntwrk/onchain-runtime-v3
  ```

  Each must report a single resolved version.

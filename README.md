# Amparo - private whistleblowing channel

Midnight Hackathon Buenos Aires, August 7-8 2026.

Someone reports a case without revealing who they are, and the system can still
prove two things that today require exposing the reporter: that the case was
**admitted by a control authority**, and that this person **has already filed N
times** - without saying how many, which ones, or who.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | React + Vite + TS demo UI (Stitch export), mock services behind a Midnight-ready boundary |
| `contracts/` | Compact circuits and their TypeScript layer |
| `contracts/src/case_admission.compact` | Case admission primitive |
| `contracts/src/filing_registry.compact` | Filing registry: threshold credential + public case alarm |
| `contracts/src/case-registry.ts` | Off-chain admitted-case mirror + alignment guard |
| `contracts/src/merkle-mirror.ts` | Merkle mirror the client rebuilds to produce paths |
| `contracts/src/verifier.ts` | Off-chain second source for a presented root |
| `contracts/src/witnesses.ts`, `filing-witnesses.ts` | Private inputs the circuits read |
| `contracts/src/midnight/` | Network configuration, wallet, providers |
| `contracts/scripts/` | Health check, wallet check, deploy, admit |
| `contracts/src/*.test.ts` | Simulator tests (no proof server) |
| `contracts/test/` | End-to-end product journey and the test strategy |
| `contracts/docker-compose.midnight.yml` | Local standalone network |

The network scripts under `contracts/scripts/` drive the **admission** contract
only. The filing registry has simulator coverage but no deployment path yet.

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

## Running against a network

Everything below works offline against a local chain. No testnet, no faucet: the
node boots with a pre-funded genesis wallet.

```bash
cd contracts
npm run mn:up          # start node, indexer and proof server
npm run mn:health      # confirm all three answer
npm run check-wallet   # confirm the wallet builds and syncs
npm run deploy         # deploy; generates the constructor proof
npm run admit-case     # admit one case end to end
npm run mn:down        # stop, and DELETE the chain state
```

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
- **`admittedRoot` is a display-only mirror.** Nothing verifies against it.
  Membership always goes through `admittedCases.checkRoot(...)`.
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

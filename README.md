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
| `contracts/src/case_admission.compact` | Case admission primitive |
| `contracts/src/case-registry.ts` | Off-chain registry mirror + alignment guard |
| `contracts/src/*.test.ts` | Simulator tests (no proof server) |

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

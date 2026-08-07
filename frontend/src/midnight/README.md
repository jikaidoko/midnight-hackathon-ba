# Midnight integration

This folder is the browser half of the contract harness. The script-side
providers under `contracts/src/midnight/` are not portable and were not meant to
be: they read proving keys off disk and build a wallet from a seed in an env
file. A page has neither.

| File | What it does |
|---|---|
| `config.ts` | Reads and validates configuration. Fails closed on the network label. |
| `providers.ts` | Indexer, proof server, ZK assets over HTTP, encrypted private state. |
| `contract.ts` | Binds the compiled contract with a URL base instead of a directory. |
| `subject-store.ts` | The reporter's secret and which cases they filed against. |
| `adapters.ts` | Chain-backed implementations of the service contracts. |

Which implementation runs is decided once, in `../services/index.ts`, from
`VITE_MN_MODE`. Screens import from there and never from here.

## Running against a chain

```bash
cp .env.example .env        # fill in the contract address
npm run build:chain         # copies the ZK assets, then builds
```

`npm run check-wasm` must report ONE version of `ledger-v8` and one of
`onchain-runtime-v3`. Two copies of either fail mid-transaction with
`expected instance of LedgerParameters`, from inside a dependency, with nothing
pointing at the duplication - and neither the typecheck nor the tests can see
it, because neither builds a transaction.

## What is not proven on chain

Selective disclosure and the voice match have no circuit behind them. Both say
so on screen, not only here: an audience cannot read the contracts.

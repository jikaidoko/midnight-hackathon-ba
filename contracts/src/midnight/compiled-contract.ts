// compiled-contract.ts - binds the compiled contract to its witness
// implementations and to its on-disk zero-knowledge assets.
//
// This is the one module that imports from `src/managed/`, so everything else
// stays independent of the compiler output layout.
//
// The contract is not instantiated here. The contract layer expects a
// descriptor - the contract CLASS plus its witnesses plus the path to its
// compiled assets - and constructs it itself when it needs to run the
// constructor or a circuit. Passing an already-constructed instance fails deep
// inside the deploy, with `Cannot read properties of undefined (reading 'ctor')`
// and no mention of this file.
//
// `CompiledContract` is imported through the protocol package rather than from
// `@midnight-ntwrk/compact-js` directly. It is the same module, re-exported, but
// it is the copy the contract layer itself resolves - taking it from anywhere
// else risks pairing a descriptor with a consumer that came from a different
// copy of the package.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract } from '../managed/amparo/contract/index.js';
import { witnesses, type AmparoPrivateState } from '../amparo-witnesses.js';
import { loadConfig, type MidnightConfig } from './config.js';
import { AMPARO, contractDir, type ContractSpec } from './contracts.js';

// Ledger decoding and the pure-circuit helpers live in `ledger.ts`, which has
// no filesystem or environment dependency, so a browser can import them
// without the descriptor below. Re-exported here so existing callers are
// unaffected.
export { ledger, pureCircuits, authorityCommitment, filingNullifier } from './ledger.js';
export type { AmparoLedger } from './ledger.js';
export type { AmparoPrivateState };
// Re-exported so nothing outside this module has to reach into `src/managed/`,
// which is the invariant that keeps the compiler output layout in one place.

/**
 * The contract descriptor: class, witnesses, and where its ZK assets live.
 *
 * `spec` carries the private-state namespace, so reporter flows pass the one
 * `forSubject` produced. It defaults to the authority namespace because that is
 * the single-identity case; every reporter call site passes its own.
 */
export function amparoContract(
  config: MidnightConfig = loadConfig(),
  spec: ContractSpec = AMPARO,
) {
  return CompiledContract.make(spec.name, Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(contractDir(spec, config)),
  );
}

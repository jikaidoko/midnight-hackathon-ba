// contract.ts — the compiled amparo contract, bound for a browser.
//
// The harness has its own binding in `contracts/src/midnight/compiled-contract.ts`,
// and it cannot be reused here: it derives the asset directory with `node:path`
// from a config module that reads `process.env`. That is correct for a script,
// which loads proving keys off disk, and unusable in a page, which fetches them
// over HTTP.
//
// So the difference is exactly one argument. `withCompiledFileAssets` documents
// that a RELATIVE path is resolved against the base each service was given, and
// the ZK config provider here was given `/zk/amparo`. Passing '.' hands
// ownership of the base to that provider instead of to the filesystem.
//
// Everything else — the contract class, the witnesses, the tag — is the same
// module the scripts use. The witness implementation in particular is imported
// rather than restated: it is what decides which private value each circuit
// reads, and a second copy that drifted would produce proofs over different
// inputs than the ones the tests cover. A page only ever acts as a reporter, so
// it builds its private state with `createSubjectState`; the authority half of
// the union stays unreachable from here.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js'
import { Contract } from '@amparo/generated/managed/amparo/contract/index.js'
import { witnesses } from '@amparo/generated/amparo-witnesses.js'

/** Matches the directory name under `src/managed/`, and the ZK asset base. */
export const AMPARO_TAG = 'amparo'

/**
 * Relative on purpose. The base is `ZK_BASE`, held by the ZK config provider —
 * an absolute path here would be resolved as a filesystem path and there is no
 * filesystem.
 */
const ASSETS_RELATIVE_TO_PROVIDER_BASE = '.'

export function amparoContract() {
  return CompiledContract.make(AMPARO_TAG, Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(ASSETS_RELATIVE_TO_PROVIDER_BASE),
  )
}

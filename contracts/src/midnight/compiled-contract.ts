// compiled-contract.ts - binds each compiled contract to its witness
// implementations and to its on-disk zero-knowledge assets.
//
// This is the one module that imports from `src/managed/`, so everything else
// stays independent of the compiler output layout. Both contracts are imported
// here, which means every script needs both compiled: `npm run compile` builds
// them together for exactly that reason.
//
// The contracts are not instantiated here. The contract layer expects a
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
//
// The two contracts' generated modules export the same names - `Contract`,
// `ledger`, `pureCircuits` - so they are imported under namespaces and
// re-exported with the contract in the name. An unqualified `ledger` that
// silently decodes the wrong contract's state is the failure this avoids.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  Contract as CaseAdmissionContract,
  ledger as caseLedger,
  pureCircuits as casePureCircuits,
} from '../managed/case_admission/contract/index.js';
import {
  Contract as FilingRegistryContract,
  ledger as filingLedger,
  pureCircuits as filingPureCircuits,
} from '../managed/filing_registry/contract/index.js';
import { witnesses as authorityWitnesses, type AuthorityPrivateState } from '../witnesses.js';
import { witnesses as subjectWitnesses, type SubjectPrivateState } from '../filing-witnesses.js';
import { loadConfig, type MidnightConfig } from './config.js';
import {
  CASE_ADMISSION,
  FILING_REGISTRY,
  contractDir,
  type ContractSpec,
} from './contracts.js';

export { caseLedger, casePureCircuits, filingLedger, filingPureCircuits };
export type { AuthorityPrivateState, SubjectPrivateState };

/** Descriptor for `case_admission`: class, witnesses, and where its ZK assets live. */
export function amparoContract(
  config: MidnightConfig = loadConfig(),
  spec: ContractSpec = CASE_ADMISSION,
) {
  return CompiledContract.make(spec.name, CaseAdmissionContract).pipe(
    CompiledContract.withWitnesses(authorityWitnesses),
    CompiledContract.withCompiledFileAssets(contractDir(spec, config)),
  );
}

/** Descriptor for `filing_registry`. Its witness is the reporter's own secret,
 *  so the caller passes the spec whose private-state namespace holds it. */
export function filingContract(
  config: MidnightConfig = loadConfig(),
  spec: ContractSpec = FILING_REGISTRY,
) {
  return CompiledContract.make(spec.name, FilingRegistryContract).pipe(
    CompiledContract.withWitnesses(subjectWitnesses),
    CompiledContract.withCompiledFileAssets(contractDir(spec, config)),
  );
}

/**
 * Public commitment of an authority secret.
 *
 * This delegates to the contract's own exported pure circuit rather than
 * recomputing the hash in TypeScript. That is not a style preference: the
 * circuit re-derives this value from the witness at proving time and compares it
 * against what the ledger holds, so a hand-written reimplementation that differs
 * in any detail - domain string, padding, hash - produces a commitment that can
 * never be satisfied, and the failure surfaces as a rejected proof rather than
 * as a mismatch anyone can read.
 */
export function authorityCommitment(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) {
    throw new Error(`authority secret must be 32 bytes long (got ${secret.length})`);
  }
  return casePureCircuits.authorityDigest(secret);
}

/**
 * The nullifier a filing by `secret` against `caseCommitment` writes on chain.
 *
 * Same reasoning as `authorityCommitment`: the leaf the circuit checks a Merkle
 * path against is derived by `filingNullifierOf` inside the proof, so the client
 * has to look up the leaf using that exact function. A reimplementation that
 * differs in the domain string produces a leaf that is not in the tree, and the
 * path lookup returns undefined with nothing to point at the cause.
 */
export function filingNullifier(secret: Uint8Array, caseCommitment: Uint8Array): Uint8Array {
  if (secret.length !== 32) {
    throw new Error(`subject secret must be 32 bytes long (got ${secret.length})`);
  }
  if (caseCommitment.length !== 32) {
    throw new Error(`case commitment must be 32 bytes long (got ${caseCommitment.length})`);
  }
  return filingPureCircuits.filingNullifierOf(secret, caseCommitment);
}

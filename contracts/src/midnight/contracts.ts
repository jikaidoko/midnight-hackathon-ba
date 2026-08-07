// contracts.ts - which compiled contract the harness is talking to.
//
// The harness was written against one contract and hardcoded its name, its
// circuit ids and its private-state namespace as module constants. There are two
// contracts, so those three facts become a descriptor and the modules that used
// to read the constants take one instead.
//
// The three travel together on purpose. They have to agree: the circuit ids are
// the filenames under `keys/`, which live in the directory named after the
// contract, and the private-state namespace decides which witness values a
// circuit will be able to read. Splitting them across three call sites is how a
// script ends up proving one contract's circuit against another's keys.

import { resolve } from 'node:path';
import type { MidnightConfig } from './config.js';

export interface ContractSpec<Id extends string = string> {
  /** Directory name under `src/managed/`, and the compiled contract's name. */
  readonly name: string;
  /**
   * Circuits that produce a proof, and so have keys on disk. Pure circuits are
   * evaluated locally and have none, so listing one here fails the key load.
   */
  readonly circuitIds: readonly Id[];
  /** Namespace the private state is stored under. */
  readonly privateStateId: string;
}

export type CaseAdmissionCircuitId = 'admitCase';
export type FilingRegistryCircuitId = 'registerFiling' | 'proveRepeatFilings';

/** Every circuit id in the repository. The provider set is shared, so it is
 *  typed on the union rather than on one contract's ids. */
export type AnyCircuitId = CaseAdmissionCircuitId | FilingRegistryCircuitId;

export const CASE_ADMISSION: ContractSpec<CaseAdmissionCircuitId> = {
  name: 'case_admission',
  circuitIds: ['admitCase'],
  privateStateId: 'amparo-authority',
};

export const FILING_REGISTRY: ContractSpec<FilingRegistryCircuitId> = {
  name: 'filing_registry',
  circuitIds: ['registerFiling', 'proveRepeatFilings'],
  privateStateId: 'amparo-subject',
};

/** Where the compiler wrote this contract: `keys/`, `zkir/`, `contract/`. */
export function contractDir(spec: ContractSpec, config: MidnightConfig): string {
  return resolve(config.managedDir, spec.name);
}

/**
 * Same contract, different private-state namespace.
 *
 * `case_admission` has a single authority, so one namespace is the whole story.
 * `filing_registry` does not: every reporter holds their own secret, and the
 * private-state provider keys by this id. Reusing one namespace across two
 * reporters on the same machine would hand the second one the first one's
 * secret, and the circuit would happily prove filings that belong to someone
 * else - the demo needs several reporters, so this is a real case, not a
 * hypothetical.
 */
export function forSubject<Id extends string>(
  spec: ContractSpec<Id>,
  label: string,
): ContractSpec<Id> {
  return { ...spec, privateStateId: `${spec.privateStateId}:${label}` };
}

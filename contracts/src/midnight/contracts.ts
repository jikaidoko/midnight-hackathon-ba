// contracts.ts - which compiled contract the harness is talking to.
//
// There is one contract now. This file existed because there were two, and the
// harness had their name, circuit ids and private-state namespace as module
// constants that could only describe one of them.
//
// The descriptor stays even at one contract, for the reason it was introduced:
// those three facts have to agree. The circuit ids are the filenames under
// `keys/`, `keys/` lives in the directory named after the contract, and the
// private-state namespace decides which witness values a circuit can read.
// Keeping them together is also what makes `forSubject` a single, obvious point
// of change rather than three call sites to remember.

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
  /**
   * Namespace the private state is stored under.
   *
   * There are two, and they are NOT interchangeable: the authority has one, and
   * every reporter has their own. This field carries whichever the caller is
   * acting as, which is why `AMPARO` below does not default it to a usable
   * value - a reporter call site that forgets `forSubject` would otherwise land
   * in the authority's namespace, and the failure would depend on the private
   * state's shape rather than on the mistake.
   */
  readonly privateStateId: string;
}

/** The authority's namespace. One identity, one namespace. */
export const AUTHORITY_PRIVATE_STATE_ID = 'amparo-authority';

/** Reporter namespaces are `${this}:${label}` - see `forSubject`. */
export const SUBJECT_PRIVATE_STATE_PREFIX = 'amparo-subject';

export type AmparoCircuitId = 'admitCase' | 'registerFiling' | 'proveRepeatFilings';
/** Kept as a distinct name because the provider set is typed on it. */
export type AnyCircuitId = AmparoCircuitId;

/**
 * The contract, as the authority sees it. `admitCase` is the only circuit an
 * authority can call, but the keys are per contract and not per role, so all
 * three are listed.
 */
export const AMPARO: ContractSpec<AmparoCircuitId> = {
  name: 'amparo',
  circuitIds: ['admitCase', 'registerFiling', 'proveRepeatFilings'],
  privateStateId: AUTHORITY_PRIVATE_STATE_ID,
};

/** Where the compiler wrote this contract: `keys/`, `zkir/`, `contract/`. */
export function contractDir(spec: ContractSpec, config: MidnightConfig): string {
  return resolve(config.managedDir, spec.name);
}

/**
 * Same contract, a per-reporter private-state namespace.
 *
 * The authority is one identity and one namespace is the whole story. Reporters
 * are not: every one holds their own secret, and the private-state provider keys
 * by this id. Reusing one namespace across two reporters on the same machine
 * would hand the second one the first one's secret, and the circuit would
 * happily prove filings that belong to someone else - the demo needs several
 * reporters, so this is a real case, not a hypothetical.
 */
export function forSubject<Id extends string>(
  spec: ContractSpec<Id>,
  label: string,
): ContractSpec<Id> {
  if (label.trim() === '') throw new Error('a reporter label cannot be empty');
  return { ...spec, privateStateId: `${SUBJECT_PRIVATE_STATE_PREFIX}:${label}` };
}

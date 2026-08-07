// zk.ts - providers for the zero-knowledge artifacts and for proof generation.
//
// These two are independent of the wallet and of the node, which makes them the
// cheapest thing to test: if `verifierKeySizes` works, the contract is compiled
// and the paths are right, without any chain involved.
//
// Everything here is per-contract: the keys live in the contract's own
// directory. That is why each function takes a `ContractSpec` - a provider built
// for one contract cannot prove the other's circuits.

import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import type { ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { loadConfig, type MidnightConfig } from './config.js';
import { contractDir, type ContractSpec } from './contracts.js';

/**
 * Reads prover keys, verifier keys and zkir from disk. The Node variant is the
 * right one here because proving happens in a script, not in a browser.
 */
export function zkConfigProvider<Id extends string>(
  spec: ContractSpec<Id>,
  config: MidnightConfig = loadConfig(),
): NodeZkConfigProvider<Id> {
  return new NodeZkConfigProvider<Id>(contractDir(spec, config));
}

/** Proof generation, delegated to the proof server over HTTP. */
export function proofProvider<Id extends string>(
  spec: ContractSpec<Id>,
  config: MidnightConfig = loadConfig(),
  zk = zkConfigProvider(spec, config),
): ProofProvider {
  return httpClientProofProvider(config.proofServerUrl, zk as never);
}

/**
 * Offline sanity check: confirms every circuit's verifier key loads from the
 * compiled contract, and returns its size in bytes.
 *
 * A failure here means the contract was not compiled (`npm run compile`) or the
 * managed directory points somewhere wrong - both of which otherwise surface
 * much later, in the middle of a deployment.
 */
export async function verifierKeySizes<Id extends string>(
  spec: ContractSpec<Id>,
  config: MidnightConfig = loadConfig(),
): Promise<Record<Id, number>> {
  const zk = zkConfigProvider(spec, config);
  const sizes = {} as Record<Id, number>;
  for (const id of spec.circuitIds) {
    const key = (await zk.getVerifierKey(id)) as unknown as Uint8Array;
    sizes[id] = key.length;
  }
  return sizes;
}

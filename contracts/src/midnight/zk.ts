// zk.ts - providers for the zero-knowledge artifacts and for proof generation.
//
// These two are independent of the wallet and of the node, which makes them the
// cheapest thing to test: if `verifierKeySizes` works, the contract is compiled
// and the paths are right, without any chain involved.

import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import type { ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { CIRCUIT_IDS, type CircuitId, type MidnightConfig } from './config.js';

/**
 * Reads prover keys, verifier keys and zkir from disk. The Node variant is the
 * right one here because proving happens in a script, not in a browser.
 */
export function zkConfigProvider(config: MidnightConfig): NodeZkConfigProvider<CircuitId> {
  return new NodeZkConfigProvider<CircuitId>(config.contractDir);
}

/** Proof generation, delegated to the proof server over HTTP. */
export function proofProvider(
  config: MidnightConfig,
  zk = zkConfigProvider(config),
): ProofProvider {
  return httpClientProofProvider(config.proofServerUrl, zk as never);
}

/**
 * Offline sanity check: confirms every circuit's verifier key loads from the
 * compiled contract, and returns its size in bytes.
 *
 * A failure here means the contract was not compiled (`npm run compile`) or
 * `contractDir` points somewhere wrong - both of which otherwise surface much
 * later, in the middle of a deployment.
 */
export async function verifierKeySizes(
  config: MidnightConfig,
): Promise<Record<CircuitId, number>> {
  const zk = zkConfigProvider(config);
  const sizes = {} as Record<CircuitId, number>;
  for (const id of CIRCUIT_IDS) {
    const key = (await zk.getVerifierKey(id)) as unknown as Uint8Array;
    sizes[id] = key.length;
  }
  return sizes;
}

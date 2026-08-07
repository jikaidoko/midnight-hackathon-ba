// config.ts - environment configuration for talking to a Midnight network.
//
// Nothing here is hardcoded per environment: endpoints, network id and the
// wallet seed all arrive through the environment, so the same build runs against
// the local chain and against a public one. Defaults describe the LOCAL network,
// because that is the one a fresh clone can actually reach.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MidnightConfig {
  /** Network id string understood by the SDK: `undeployed`, `preprod`, ... */
  networkId: string;
  /** Proof server. Always local: proving is client-side by design. */
  proofServerUrl: string;
  /** Indexer GraphQL endpoint for queries, and its websocket for subscriptions. */
  indexerUrl: string;
  indexerWsUrl: string;
  /** Substrate node, used to submit transactions. */
  nodeUrl: string;
  /** Hex seed of the wallet. Secret on any funded network. */
  walletSeed: string;
  /** Directory of the compiled contract; holds `keys/` and `zkir/`. */
  contractDir: string;
}

const HERE = dirname(fileURLToPath(import.meta.url)); // .../src/midnight
/** Package root: .../contracts */
export const PKG_ROOT = resolve(HERE, '..', '..');

/**
 * Loads `contracts/.env` into `process.env` using Node's built-in loader.
 *
 * Variables already set in the shell are NOT overwritten, which is the property
 * the scripts rely on to be pointed at another network for a single command
 * without editing a `.env` that holds a seed for a different one.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(resolve(PKG_ROOT, '.env'));
  } catch {
    // No `.env` present, or already loaded. Defaults and the shell environment
    // are enough to run against the local network.
  }
}

/**
 * Seed of the genesis wallet of the local `dev` preset, which holds the initial
 * supply. Public, disposable, and worthless anywhere else - this is the reason
 * the local network needs no faucet. NOT a secret.
 */
export const LOCAL_GENESIS_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

/** Name of the compiled contract directory under `src/managed/`. */
export const CONTRACT_NAME = 'case_admission';

/**
 * Circuit ids of the contract. These are the keys under which prover and
 * verifier keys are stored on disk, so they must match the exported circuits of
 * the `.compact` source exactly.
 *
 * Only circuits that produce a proof are listed: `authorityDigest` is a pure
 * circuit and has no keys.
 */
export const CIRCUIT_IDS = ['admitCase'] as const;
export type CircuitId = (typeof CIRCUIT_IDS)[number];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MidnightConfig {
  loadDotEnv();

  const networkId = env.MN_NETWORK ?? 'undeployed';
  const isLocal = networkId.toLowerCase() === 'undeployed';
  const seed = (env.MN_WALLET_SEED ?? '').trim();

  return {
    networkId,
    proofServerUrl: env.MN_PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
    indexerUrl: env.MN_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUrl: env.MN_INDEXER_WS_URL ?? 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    nodeUrl: env.MN_NODE_URL ?? 'http://127.0.0.1:9944',
    // An empty seed falls back to the funded genesis wallet, but only locally.
    // On a public network it stays empty so the caller gets an explicit error
    // instead of silently building a wallet nobody funded.
    walletSeed: seed !== '' ? seed : isLocal ? LOCAL_GENESIS_SEED : '',
    contractDir: env.MN_CONTRACT_DIR ?? resolve(PKG_ROOT, 'src', 'managed', CONTRACT_NAME),
  };
}

/** One-line summary for script banners. Never includes the seed. */
export function describe(config: MidnightConfig): string {
  return [
    `network:  ${config.networkId}`,
    `node:     ${config.nodeUrl}`,
    `indexer:  ${config.indexerUrl}`,
    `proof:    ${config.proofServerUrl}`,
    `contract: ${config.contractDir}`,
  ].join('\n');
}

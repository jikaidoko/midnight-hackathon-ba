// config.ts — where the interface points, and which network it believes it is on.
//
// Every value is required and none has a default. A default network label is
// the expensive kind of wrong: the interface keeps working, addresses still
// look valid, and the only symptom is that it is reading a different chain than
// the one the user is transacting on. Failing at startup with a named missing
// variable costs a minute; a silently wrong label costs the demo.
//
// Read at module load rather than per call, so a misconfigured build fails on
// the first import instead of on the first transaction.

import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id'

export interface AmparoConfig {
  readonly networkId: NetworkId
  readonly indexerUrl: string
  readonly indexerWsUrl: string
  readonly proofServerUrl: string
  /** Deployed `amparo` contract address. One contract, one address. */
  readonly contractAddress: string
  /**
   * `reviewThreshold` cannot be read from the chain: it is a `sealed` ledger
   * field, and sealed fields are absent from the generated projection. The
   * circuit reads it; no client can. It comes from the deployment record.
   */
  readonly reviewThreshold: bigint
}

function required(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv] as string | undefined
  if (!value) {
    throw new Error(
      `${name} is not set. The interface will not guess: an unset network or address ` +
        'reads as a working app pointed at the wrong chain.',
    )
  }
  return value
}

/**
 * Fail-closed on the network label, and it validates the VALUE rather than
 * just its presence. Presence alone does not protect against the wrong label —
 * a build configured for one network and pointed at another's indexer answers
 * every query happily.
 */
const NETWORKS = ['undeployed', 'devnet', 'testnet', 'mainnet'] as const

function networkOf(raw: string): NetworkId {
  // `NetworkId` is a bare string in this SDK, so nothing stops a typo from
  // being accepted and every address from being derived for a network nobody
  // named. The allow-list is the second source that makes the check mean
  // something: it fails on evidence of a wrong value, not just a missing one.
  if (!(NETWORKS as readonly string[]).includes(raw)) {
    throw new Error(
      `VITE_MN_NETWORK is "${raw}", which is not a network. ` +
        `Expected one of: ${NETWORKS.join(', ')}.`,
    )
  }
  // Set globally, because address encoding and transaction assembly read it
  // from this singleton rather than from anything passed in. Skipping it does
  // not fail loudly; it produces addresses for whatever was set last.
  setNetworkId(raw)
  return raw
}

export function loadConfig(): AmparoConfig {
  const threshold = required('VITE_MN_REVIEW_THRESHOLD')
  if (!/^[0-9]+$/.test(threshold)) {
    throw new Error(`VITE_MN_REVIEW_THRESHOLD is "${threshold}", which is not a number.`)
  }
  return {
    networkId: networkOf(required('VITE_MN_NETWORK')),
    indexerUrl: required('VITE_MN_INDEXER_URL'),
    indexerWsUrl: required('VITE_MN_INDEXER_WS_URL'),
    proofServerUrl: required('VITE_MN_PROOF_SERVER_URL'),
    contractAddress: required('VITE_MN_CONTRACT_ADDRESS'),
    reviewThreshold: BigInt(threshold),
  }
}

/**
 * Whether to talk to a chain at all.
 *
 * Explicit rather than inferred from whether the other variables happen to be
 * set: "some variables are present" is not a statement of intent, and the
 * failure mode of guessing is a demo that silently runs on mocks in front of
 * an audience that was told it was live.
 */
export function useChain(): boolean {
  return import.meta.env.VITE_MN_MODE === 'chain'
}

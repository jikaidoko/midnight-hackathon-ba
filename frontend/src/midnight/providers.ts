// providers.ts — the browser half of the harness.
//
// The script-side providers are not portable and were not meant to be. They
// read proving keys off disk with `NodeZkConfigProvider`, and they build a
// wallet from a seed in an env file. A browser has neither: keys are fetched
// over HTTP from the app's own origin, and the wallet belongs to the user, via
// the connector their extension injects. Same interfaces, different sources.
//
// The private-state provider is the one that matters for privacy. It is where
// the reporter's secret lives, and it never leaves the device — no provider
// here sends it anywhere, and the proof server receives a proving request, not
// the witness values it was built from.

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider'
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider'
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider'
import type { AmparoConfig } from './config'

/**
 * Circuits with keys on disk that a page can reach. `admitCase` has one too,
 * but it is the authority's alone — a reporter session never calls it, so it
 * is left off this type rather than fetched and unused.
 */
export type AmparoCircuitId = 'registerFiling' | 'proveRepeatFilings'

/**
 * Where the compiler's `keys/`, `zkir/` and `verifier/` are served from.
 *
 * They have to be reachable as static assets on this origin. That is a build
 * step, not a runtime one: `contracts/src/managed/amparo/` is copied into
 * `public/zk/` before the app is built. Missing keys otherwise surface as a
 * 404 during proving — several seconds after the user pressed the button — so
 * `assertZkAssets` checks for them up front.
 */
// Absolute, not root-relative. `FetchZkConfigProvider` builds its fetch targets
// with `new URL(...)`, which REQUIRES an absolute URL and throws "Invalid URL"
// on a bare path - at construction, before any key is fetched, so the page dies
// on startup in chain mode while mock mode never reaches it.
export const ZK_BASE = new URL('/zk/amparo', window.location.origin).toString()

/**
 * Store names. NOT absolute paths.
 *
 * `levelPrivateStateProvider` ignores an absolute path here and silently falls
 * back to its own default, so a config that looks like it relocated the store
 * has not — and the store holds the credential. If a `.gitignore` entry names
 * the path you thought you configured, verify with `git check-ignore` rather
 * than by reading the file.
 */
export const MIDNIGHT_DB = 'amparo-midnight'
export const PRIVATE_STATE_STORE = 'amparo-private-state'
export const SIGNING_KEY_STORE = 'amparo-signing-keys'

export const PRIVATE_STATE_ID = 'amparo-subject'

export interface AmparoProviders {
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>
  zkConfigProvider: FetchZkConfigProvider<AmparoCircuitId>
  proofProvider: ReturnType<typeof httpClientProofProvider>
  privateStateProvider: ReturnType<typeof levelPrivateStateProvider>
}

/**
 * Password that encrypts the private state at rest.
 *
 * Required, with no default, and NOT derived from anything the page knows: the
 * SDK's own guidance is that public key material must never be the password
 * source, and a password computed from a public value encrypts nothing from
 * anyone who can read the same value.
 *
 * A build-time constant is honest only about what it is: it protects the store
 * from another origin, not from whoever holds the build. Prompting the reporter
 * is what makes this real, and it is the gap to close before this handles an
 * actual report.
 *
 * The SDK enforces a strength policy — 16+ characters, 3 of 4 character
 * classes, no runs, no sequences — and a violation surfaces as
 * `PasswordValidationError` on the first write, which is well after startup.
 * Checking the length here turns the common half of that into a startup error.
 */
function privateStatePassword(): string {
  const password = import.meta.env.VITE_MN_PRIVATE_STATE_PASSWORD as string | undefined
  if (!password) {
    throw new Error(
      'VITE_MN_PRIVATE_STATE_PASSWORD is not set. It encrypts the reporter credential at ' +
        'rest, and there is no safe default: a password derived from anything public ' +
        'protects against nobody.',
    )
  }
  if (password.length < 16) {
    throw new Error(
      'VITE_MN_PRIVATE_STATE_PASSWORD is shorter than the 16 characters the SDK requires. ' +
        'Left alone this fails on the first write, not at startup.',
    )
  }
  return password
}

/**
 * Fails early if the proving keys were not published with the app.
 *
 * Without this the first symptom is a proof that fails after the transaction
 * flow has already started, which reads like a circuit problem. It is a
 * deployment problem, and it is knowable before anyone presses anything.
 *
 * The status code alone does NOT answer the question, and trusting it made this
 * guard useless in the one mode it matters most. A dev server answers an
 * unknown path with the SPA fallback - `index.html`, HTTP 200 - so a missing
 * proving key looks exactly like a present one. Measured here: a deliberately
 * invented path returned 200. The guard was silent, and a silent guard is
 * indistinguishable from an approving one.
 *
 * So it asks whether what came back is a key rather than whether something came
 * back: HTML is the fallback, never a prover. Both circuits are probed because
 * they are published as one directory but fetched independently, and a partial
 * copy would otherwise be caught only by whichever flow the demo ran second.
 */
export async function assertZkAssets(): Promise<void> {
  const circuits: AmparoCircuitId[] = ['registerFiling', 'proveRepeatFilings']

  for (const circuit of circuits) {
    const probe = `${ZK_BASE}/keys/${circuit}.prover`
    const response = await fetch(probe, { method: 'HEAD' })

    if (!response.ok) {
      throw new Error(
        `Proving keys are not being served (${probe} returned ${response.status}). ` +
          'Copy `contracts/src/managed/amparo/` into `frontend/public/zk/` before ' +
          'building; the interface cannot generate a proof without them.',
      )
    }

    if ((response.headers.get('content-type') ?? '').includes('text/html')) {
      throw new Error(
        `${probe} answered with HTML, not a proving key. That is this server's ` +
          'fallback page for a path it does not have, so the key is MISSING - the ' +
          '200 says the server is up, not that the key exists. Run `npm run copy-zk`.',
      )
    }
  }
}

export function buildProviders(config: AmparoConfig): AmparoProviders {
  const zkConfigProvider = new FetchZkConfigProvider<AmparoCircuitId>(ZK_BASE, fetch.bind(window))
  const password = privateStatePassword()

  return {
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServerUrl, zkConfigProvider as never),
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: MIDNIGHT_DB,
      privateStateStoreName: PRIVATE_STATE_STORE,
      signingKeyStoreName: SIGNING_KEY_STORE,
      privateStoragePasswordProvider: async () => password,
      // Scopes storage so two reporters on one browser cannot read each other's
      // credential. Keyed by the contract as well as the network: a redeploy
      // starts an empty nullifier tree, and mixing the two would let the
      // interface count filings that can never back a credential here.
      accountId: `${config.networkId}:${config.contractAddress}`,
    }),
  }
}

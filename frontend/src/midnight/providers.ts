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
 * Circuits with keys on disk that a page in THIS app can reach.
 *
 * The contract has four and this build reaches three. `registerFiling` and
 * `proveRepeatFilings` belong to the reporter; `respondToCase` belongs to the
 * control body, whose portal lives at `/control` in this same build, so its key
 * has to be served like any other.
 *
 * `admitCase` is the one left off, and deliberately: admission has no screen
 * here. Nothing in this app can call it, so fetching its key would only make the
 * guard pass for a flow that does not exist.
 *
 * This list is what `assertZkAssets` probes, so a circuit missing from it is a
 * guard that reports success while the very key that flow needs is unserved —
 * and that failure lands seconds after the button, which is the exact failure
 * the guard was written to move earlier. Adding a screen means adding its
 * circuit here.
 */
export type AmparoCircuitId = 'registerFiling' | 'proveRepeatFilings' | 'respondToCase'

/**
 * The same list as a value, because a type is erased at build time and the
 * guard has to iterate something at runtime.
 *
 * It is a `Record` and not an array so the compiler enforces the pairing:
 * widening `AmparoCircuitId` without adding the member here fails to typecheck,
 * which is the only mechanism that keeps the guard's coverage honest. An array
 * annotated with the union accepts any subset of it silently — including the
 * empty one, where the guard probes nothing and reports success.
 */
const REACHABLE_CIRCUITS: Record<AmparoCircuitId, true> = {
  registerFiling: true,
  proveRepeatFilings: true,
  respondToCase: true,
}

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

/**
 * One key per ROLE, not one per app.
 *
 * The two roles hold different credentials — a reporter's `subjectSecret`, the
 * control body's `authoritySecret` — and the witness object refuses to serve one
 * from the other's state. Filing them under a single key would mean whichever
 * role wrote first owns the slot, and `initialPrivateState` is only consulted
 * when the key is ABSENT: the second role's state would be silently ignored
 * rather than rejected, and the failure would surface as the wrong role's secret
 * being offered to the circuit.
 *
 * Both live in the same store, scoped by the same `accountId`. Separate keys are
 * exactly what `privateStateId` is for.
 */
export const PRIVATE_STATE_ID = 'amparo-subject'
export const AUTHORITY_PRIVATE_STATE_ID = 'amparo-authority'

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
 * back: HTML is the fallback, never a prover. Every circuit this app can reach
 * is probed - see `AmparoCircuitId` for which two those are and why the
 * authority's are not - because they are published as one directory but fetched
 * independently, and a partial copy would otherwise be caught only by whichever
 * flow the demo ran second.
 */
export async function assertZkAssets(): Promise<void> {
  const circuits = Object.keys(REACHABLE_CIRCUITS) as AmparoCircuitId[]

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

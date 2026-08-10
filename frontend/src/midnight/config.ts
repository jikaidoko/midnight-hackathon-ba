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
  /**
   * Substrate node. Only writes need it — reads go through the indexer — but it
   * is required all the same, because the alternative is a build that looks
   * healthy until the first button and then cannot say where it would have sent
   * the transaction.
   */
  readonly nodeUrl: string
  /** Deployed `amparo` contract address. One contract, one address. */
  readonly contractAddress: string
  /**
   * `reviewThreshold` cannot be read from the chain: it is a `sealed` ledger
   * field, and sealed fields are absent from the generated projection. The
   * circuit reads it; no client can. It comes from the deployment record.
   */
  readonly reviewThreshold: bigint
  /**
   * Preimage of the published `authorityCommitment`, as 64 hex characters.
   *
   * OPTIONAL, and the option is the design: this build serves both roles from
   * one origin, and a reporter has no business holding it. Requiring it would
   * make every reader supply the credential that lets someone answer cases.
   * Absent is a legitimate build, so its absence must not fail at startup — it
   * fails when someone tries to record an answer, named.
   *
   * 🔴 When set, WHOEVER HOLDS THE BUILD IS THE CONTROL BODY. It is no longer the
   * only way in, and it is no longer the preferred one: `authority.ts` lets the
   * body present its secret in the portal, held for the session and absent from
   * the bundle. That path is what makes distributing the app stop being
   * distributing the authority, and it makes the role VISIBLE in the interface
   * rather than implied by which variables a build was compiled with.
   *
   * This one survives as a local-network and CI convenience, where the
   * deployment record is generated fresh and worthless. It loses to a presented
   * secret, so a build that carries one can still be driven by whoever is
   * actually sitting at the portal — and the shell says which of the two is in
   * use, because a credential nobody can see is a credential nobody audits.
   */
  readonly authoritySecret?: Uint8Array
}

/** 32 bytes as 64 hex characters — the shape of both secrets this build reads. */
const HEX_32 = /^[0-9a-fA-F]{64}$/

/**
 * The PREDICATES are shared; the wording is not.
 *
 * The authority secret now has a second way in — pasted into the portal — and
 * both doors have to test the same thing, or the looser one decides. What they
 * must NOT share is the sentence: one audience is a developer reading a startup
 * failure with a variable name in it, the other is an official at a Spanish
 * screen. Exporting a message-formatting helper instead of the test is how a
 * refusal ends up half in each language, which is exactly what happened the
 * first time this was written.
 */
export function isHex32(hex: string): boolean {
  return HEX_32.test(hex)
}

/** Assumes `isHex32`. Callers phrase their own refusal before reaching this. */
export function decodeHex32(hex: string): Uint8Array {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * Whether this value is the wallet seed — the one substitution the shape invites.
 *
 * Both secrets are 32 random bytes written as 64 hex characters and nothing about
 * either says which is which. Swapping them does not fail readably: the witness
 * hands over whatever it was given, a valid proof of a false statement gets built
 * — tens of seconds of real work — and the transaction dies inside the circuit on
 * a digest that cannot match.
 *
 * It matters MORE for a pasted value than a compiled one. A build is configured
 * once by someone reading a file that names both; the portal is a text field an
 * official pastes into from a clipboard that held something else a moment ago.
 */
export function isWalletSeed(rawHex: string): boolean {
  const seed = import.meta.env.VITE_MN_WALLET_SEED as string | undefined
  return Boolean(seed) && rawHex.toLowerCase() === (seed as string).toLowerCase()
}

/** Configuration's own phrasing: developer-facing, English, names the variable. */
function hex32(hex: string, name: string): Uint8Array {
  if (!isHex32(hex)) {
    throw new Error(
      `${name} must be exactly 64 hex characters, with no 0x prefix and no whitespace.`,
    )
  }
  return decodeHex32(hex)
}

/**
 * Reads the authority secret, and refuses the one substitution its shape invites.
 *
 * The wallet seed and the authority secret are both 32 random bytes written as
 * 64 hex characters, they sit next to each other in the same file, and they do
 * unrelated jobs: the seed pays and signs, the secret proves who is answering.
 * Nothing about either value says which is which.
 *
 * Swapping them does not fail readably. The witness hands over whatever it was
 * given, a valid proof of a false statement gets built — tens of seconds of real
 * work — and the transaction dies inside the circuit on a digest that does not
 * match the published commitment. Comparing the two is a second source: it fails
 * on evidence that the value is wrong, not merely that it is missing, and it
 * fails before the proving rather than after.
 */
function authoritySecretOf(): Uint8Array | undefined {
  const raw = import.meta.env.VITE_MN_AUTHORITY_SECRET as string | undefined
  if (!raw) return undefined

  const secret = hex32(raw, 'VITE_MN_AUTHORITY_SECRET')
  if (isWalletSeed(raw)) {
    throw new Error(
      'VITE_MN_AUTHORITY_SECRET is the same value as VITE_MN_WALLET_SEED. They are ' +
        'different credentials that happen to share a shape: the seed funds and signs the ' +
        'transaction, the secret is the preimage of the published authority commitment. ' +
        'Left alone this builds a proof and then fails inside the circuit, long after the ' +
        'button.',
    )
  }
  return secret
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
    nodeUrl: required('VITE_MN_NODE_URL'),
    contractAddress: required('VITE_MN_CONTRACT_ADDRESS'),
    reviewThreshold: BigInt(threshold),
    authoritySecret: authoritySecretOf(),
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

// wallet.ts — the wallet that balances, signs and submits, built in the page.
//
// WHAT THIS IS, said plainly, because the honest description is the whole
// caveat: the wallet is derived from a seed baked into the build. Whoever holds
// the build holds the wallet. That is acceptable for a local network whose
// genesis seed is public and worthless, and it is NOT a wallet for anybody's
// real funds. The architecture this grows into is the connector API, where the
// key belongs to the user and the page never sees it; the shape here — one
// module owning the wallet, everything else asking for a provider — is what
// makes that a replacement of this file rather than a rewrite of the adapters.
//
// It is built LAZILY, on the first write, and never on load. Reading the ledger
// needs no wallet at all, which is the property the oversight portal rests on:
// anyone can derive the backlog. Building it eagerly would make every reader
// wait for a sync to see public state, and would quietly turn "no wallet" from a
// condition of writing into a condition of looking.
//
// There is no sync-state persistence here. The script side saves it to disk
// because a public network costs hours from genesis; a browser has no such
// store, so this is a cold start every time. On the local chain that is seconds.
// Against a public network it would not be, and that is a second reason this
// file is the local-network wallet rather than the general one.

import * as ledger from '@midnight-ntwrk/ledger-v8'
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade'
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd'
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded'
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet'
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet'
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions'
import { filter, firstValueFrom, throwError, timeout, type Observable } from 'rxjs'

import {
  makeWalletProvider,
  type FacadeState,
  type WalletCtx,
} from '@amparo/contracts/wallet-provider'
import type { AmparoConfig } from './config'
import type { AmparoProviders } from './providers'

/**
 * Hex to bytes, without `Buffer`.
 *
 * `Buffer.from(hex, 'hex')` is what the script side uses and it does not exist
 * here — but the trap is that it does not FAIL here either, because Vite can be
 * made to shim it. It also truncates silently on the first non-hex character,
 * so a seed with a stray space becomes a shorter, perfectly valid-looking seed
 * for a different wallet. This refuses instead.
 */
function seedBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'VITE_MN_WALLET_SEED must be exactly 64 hex characters, with no 0x prefix and no ' +
        'whitespace. A malformed seed does not fail loudly: it derives a different wallet, ' +
        'which then appears to have no funds.',
    )
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** Derives the three role keys the sub-wallets need from one HD seed. */
function deriveKeys(seedHex: string) {
  const hd = HDWallet.fromSeed(seedBytes(seedHex))
  if (hd.type !== 'seedOk') {
    throw new Error('VITE_MN_WALLET_SEED was rejected by the HD wallet as a seed.')
  }
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0)
  if (derived.type !== 'keysDerived') {
    throw new Error('HD key derivation failed for the supplied seed')
  }
  // Clear the seed material now that the keys are derived. It stays in the
  // bundle either way — this only shortens how long it sits in live memory.
  hd.hdWallet.clear()
  return derived.keys
}

async function buildWallet(config: AmparoConfig): Promise<WalletCtx> {
  const seed = import.meta.env.VITE_MN_WALLET_SEED as string | undefined
  if (!seed) {
    throw new Error(
      'VITE_MN_WALLET_SEED is not set, so nothing can sign. Reading the ledger works ' +
        'without it; filing a report, presenting a credential and recording an answer do ' +
        'not. On the local network use its genesis seed, which is public and unfunded ' +
        'anywhere else.',
    )
  }

  const keys = deriveKeys(seed)
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap])
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust])
  const keystore = createKeystore(keys[Roles.NightExternal], config.networkId)

  const configuration = {
    networkId: config.networkId,
    indexerClientConnection: {
      indexerHttpUrl: config.indexerUrl,
      indexerWsUrl: config.indexerWsUrl,
      // Backpressure between the indexer feed and the apply loop. The in-flight
      // queue is what grows during a historical scan, and an uncapped one is how
      // a sync dies of memory exhaustion minutes in, looking healthy until it
      // stops. A tab has less headroom than a script, not more.
      bufferSize: 2000,
      resumeThreshold: 100,
    },
    batchUpdates: { spacing: 8 },
    provingServerUrl: new URL(config.proofServerUrl),
    // Submission goes to the node over websocket, whatever scheme the node URL
    // was written with.
    relayURL: new URL(config.nodeUrl.replace(/^http/, 'ws')),
  }

  const wallet = await WalletFacade.init({
    configuration: configuration as never,
    shielded: (c: never) =>
      ShieldedWallet({
        ...(c as object),
        txHistoryStorage: new NoOpTransactionHistoryStorage(),
      } as never).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (c: never) =>
      UnshieldedWallet({
        ...(c as object),
        txHistoryStorage: new NoOpTransactionHistoryStorage(),
      } as never).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (c: never) =>
      DustWallet({
        ...(c as object),
        costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
        txHistoryStorage: new NoOpTransactionHistoryStorage(),
      } as never).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  })

  await wallet.start(shieldedSecretKeys, dustSecretKey)
  return { wallet, shieldedSecretKeys, dustSecretKey, keystore }
}

/**
 * The provider set, with signing attached.
 *
 * Memoised on the PROMISE rather than on the result, so two buttons pressed
 * before the first sync finishes share one wallet instead of starting a second
 * one against the same seed. A rejected attempt is forgotten, so a failure that
 * the user can fix — an unreachable node, a seed they corrected — can be retried
 * without reloading the page.
 */
let pending: Promise<AmparoProviders> | null = null

/**
 * How long the sync may take before this reports instead of waiting.
 *
 * The number is secondary; having one at all is the point. Waiting on a filtered
 * stream with no deadline produces a promise that neither resolves nor rejects,
 * and everything above it is written to handle a result or an error — so the
 * caller's `catch` never runs, the button keeps saying it is working, and a
 * stalled sync is indistinguishable from a slow one. That failure was measured:
 * the control portal sat on "generating proof" for minutes with no error, and
 * the wait was here, before any proof had been requested.
 *
 * Sized for the local network, where a cold start is seconds. A public network
 * takes hours from genesis, so this file's number is wrong there for the same
 * reason its baked-in seed is: it is the local-network wallet. Whatever replaces
 * it needs its own deadline, not none.
 */
const SYNC_TIMEOUT_MS = 90_000

export function withWallet(
  base: AmparoProviders,
  config: AmparoConfig,
): Promise<AmparoProviders> {
  if (!pending) {
    pending = (async () => {
      const ctx = await buildWallet(config)
      const state = await firstValueFrom(
        (ctx.wallet.state() as unknown as Observable<FacadeState>).pipe(
          filter((s) => s.isSynced === true),
          // `first`, not `each`: the filter suppresses every state until the
          // synced one, so there is exactly one emission to wait for and the
          // deadline is on reaching it.
          timeout({
            first: SYNC_TIMEOUT_MS,
            with: () =>
              throwError(
                () =>
                  new Error(
                    `The wallet did not finish syncing within ${SYNC_TIMEOUT_MS / 1000}s, so ` +
                      'nothing was signed or submitted. Check that the node and indexer in ' +
                      'this build are reachable and are the ones the contract was deployed ' +
                      'against. Reads do not need the wallet, which is why the rest of the ' +
                      'app keeps working while writes do not.',
                  ),
              ),
          }),
        ),
      )
      const walletProvider = makeWalletProvider(ctx, state)
      return {
        ...base,
        walletProvider,
        midnightProvider: walletProvider,
      } as unknown as AmparoProviders
    })().catch((error) => {
      pending = null
      throw error
    })
  }
  return pending
}

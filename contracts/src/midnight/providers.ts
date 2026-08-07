// providers.ts - wallet construction and the provider set the contract layer needs.
//
// Two things happen here, and they are worth separating when reading:
//
// 1. Building a wallet from a seed. The SDK splits a wallet into three
//    sub-wallets (shielded, unshielded, dust) derived from one HD seed, and
//    joins them behind a facade. Each one syncs against the indexer.
//
// 2. Assembling the providers that `deployContract` / `findDeployedContract`
//    consume: where the ZK artifacts come from, who generates proofs, who reads
//    public state, where private state lives, and who balances, signs and
//    submits transactions.
//
// The sync-state persistence in the middle is not an optimization. A wallet
// starting cold scans the chain from genesis, which on a public network is
// hours; saving the sync state and restoring it turns every later start into an
// incremental catch-up. See `startPersistence`.

import { firstValueFrom, filter, type Observable } from 'rxjs';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig, PKG_ROOT, type CircuitId, type MidnightConfig } from './config.js';
import { zkConfigProvider } from './zk.js';

/** Namespace under which this contract's private state is stored. */
export const PRIVATE_STATE_ID = 'amparo-authority';

/**
 * Directory name of the local private-state database. Must stay in sync with the
 * matching entry in the repository .gitignore: this database holds the authority
 * credential.
 */
export const PRIVATE_STATE_STORE = 'midnight-level-db';

type Keystore = ReturnType<typeof createKeystore>;
type SubWallet = 'shielded' | 'unshielded' | 'dust';

/** A built wallet plus the key material needed to balance and sign. */
export interface WalletCtx {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  keystore: Keystore;
  /** Stops the periodic state save. Call it before exiting. */
  stopPersist?: () => void;
}

/** Shape of the facade state the scripts read. */
export interface FacadeState {
  isSynced: boolean;
  shielded: {
    coinPublicKey: { toHexString(): string };
    encryptionPublicKey: { toHexString(): string };
  };
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/**
 * Reads an integer from the environment, tolerating absent, empty and
 * non-numeric values.
 *
 * The tolerance matters: `Number('abc')` is `NaN`, and `NaN > 0` is `false`, so
 * a typo in a tuning variable would silently disable the feature it configures
 * rather than fail. Falling back to the default keeps a typo harmless.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Sync-state persistence
// ---------------------------------------------------------------------------

/**
 * Directory holding the saved sync state, keyed by network AND by a digest of
 * the seed.
 *
 * Both parts of the key are load-bearing. Without the network, pointing the same
 * wallet at a different chain would restore state describing the wrong ledger.
 * Without the seed digest, two wallets on one network would overwrite each
 * other, and the symptom - a wallet that suddenly re-scans from genesis - looks
 * like a network problem rather than a collision.
 */
function walletStateDir(config: MidnightConfig): string {
  const seedTag = createHash('sha256').update(config.walletSeed).digest('hex').slice(0, 12);
  return resolve(PKG_ROOT, '.wallet-state', `${config.networkId}-${seedTag}`);
}

function readStateBlob(dir: string, key: SubWallet): string | undefined {
  const file = resolve(dir, `${key}.blob`);
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes a state blob atomically: full write to a temporary file, then rename.
 *
 * A process killed halfway through a direct write leaves a truncated blob, and a
 * truncated blob is worse than no blob - it is read back on the next start and
 * fails there. Rename within a filesystem is atomic, so the worst outcome here
 * is an orphan temporary file that the next save overwrites.
 */
function writeStateBlob(dir: string, key: SubWallet, blob: string): void {
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, `${key}.blob`);
  const temp = `${target}.tmp`;
  writeFileSync(temp, blob);
  renameSync(temp, target);
}

/**
 * Restores a sub-wallet from a saved blob, falling back to a cold start if the
 * blob cannot be read.
 *
 * The fallback is deliberate: a corrupt blob must cost a slow sync, never a
 * wallet that refuses to start. The bad blob is deleted so the next save can
 * replace it.
 */
function restoreOrStart<T>(
  dir: string,
  key: SubWallet,
  blob: string | undefined,
  restoreFn: (blob: string) => T,
  startFn: () => T,
): T {
  if (blob === undefined) return startFn();
  try {
    return restoreFn(blob);
  } catch (error) {
    console.warn(
      `Saved ${key} state is unreadable; discarding it and syncing from genesis: ` +
        `${(error as Error).message}`,
    );
    try {
      rmSync(resolve(dir, `${key}.blob`));
    } catch {
      // Already gone.
    }
    return startFn();
  }
}

/**
 * Saves the sync state of all three sub-wallets on an interval, so the next
 * start resumes instead of re-scanning. Returns a stop function.
 */
function startPersistence(wallet: WalletFacade, dir: string, intervalMs: number): () => void {
  let saving = false;

  const save = async (): Promise<void> => {
    // A save slower than the interval must not stack up behind itself.
    if (saving) return;
    saving = true;
    try {
      for (const key of ['shielded', 'unshielded', 'dust'] as const) {
        const sub = (wallet as unknown as Record<
          SubWallet,
          { serializeState?: () => Promise<string> }
        >)[key];
        try {
          const blob = await sub?.serializeState?.();
          if (typeof blob === 'string' && blob.length > 0) writeStateBlob(dir, key, blob);
        } catch {
          // Serialization can legitimately fail early in a sync, before there is
          // any state to write. The next tick retries.
        }
      }
    } finally {
      saving = false;
    }
  };

  const timer = setInterval(() => void save(), intervalMs);
  // Do not hold the process open just for the save timer.
  timer.unref?.();
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/** Derives the three role keys the sub-wallets need from one HD seed. */
function deriveKeys(seedHex: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hd.type !== 'seedOk') {
    throw new Error(
      'MN_WALLET_SEED is not a valid seed. It must be hex, with no 0x prefix and no whitespace.',
    );
  }
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') {
    throw new Error('HD key derivation failed for the supplied seed');
  }
  // Clear the seed material from memory now that the keys are derived.
  hd.hdWallet.clear();
  return derived.keys;
}

/** Configuration shared by the three sub-wallets. */
function walletConfiguration(config: MidnightConfig) {
  // Backpressure between the indexer websocket feed and the apply loop. The
  // in-flight queue is what grows during a long historical scan, so capping it
  // keeps memory flat at the cost of some sync speed. Both are tunable from the
  // environment so a slow machine can be adjusted without a code change.
  const bufferSize = envInt('MN_SYNC_BUFFER_SIZE', 2000);
  const batchSpacing = envInt('MN_SYNC_BATCH_SPACING', 8);

  return {
    networkId: config.networkId,
    indexerClientConnection: {
      indexerHttpUrl: config.indexerUrl,
      indexerWsUrl: config.indexerWsUrl,
      bufferSize,
      // Reopen the subscription once the queue has drained to this level.
      resumeThreshold: 100,
    },
    batchUpdates: { spacing: batchSpacing },
    provingServerUrl: new URL(config.proofServerUrl),
    // Submission goes to the node over websocket, whatever scheme the node URL
    // was written with.
    relayURL: new URL(config.nodeUrl.replace(/^http/, 'ws')),
  };
}

/**
 * Builds the wallet and starts syncing. Restores saved sync state when present,
 * unless `MN_WALLET_COLD_START=true` forces a full re-scan.
 */
export async function buildWallet(config: MidnightConfig): Promise<WalletCtx> {
  if (!config.walletSeed) {
    throw new Error(
      `No wallet seed for network "${config.networkId}". Set MN_WALLET_SEED in contracts/.env ` +
        '(see .env.example). Only the local network has a default, pre-funded wallet.',
    );
  }

  setNetworkId(config.networkId);
  const keys = deriveKeys(config.walletSeed);

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore = createKeystore(keys[Roles.NightExternal], config.networkId);

  const stateDir = walletStateDir(config);
  const coldStart = process.env.MN_WALLET_COLD_START === 'true';
  const saved = {
    shielded: coldStart ? undefined : readStateBlob(stateDir, 'shielded'),
    unshielded: coldStart ? undefined : readStateBlob(stateDir, 'unshielded'),
    dust: coldStart ? undefined : readStateBlob(stateDir, 'dust'),
  };
  if (saved.shielded ?? saved.unshielded ?? saved.dust) {
    console.log(`Resuming wallet sync from ${stateDir}`);
  } else {
    console.log('No saved wallet state: syncing from genesis. This is the slow path.');
  }

  const configuration = walletConfiguration(config);

  // The facade builds each sub-wallet through a factory so the caller decides
  // between resuming and starting fresh, per sub-wallet.
  const wallet = await WalletFacade.init({
    configuration: configuration as never,
    shielded: (c: never) => {
      const w = ShieldedWallet({
        ...(c as object),
        txHistoryStorage: new NoOpTransactionHistoryStorage(),
      } as never);
      return restoreOrStart(
        stateDir,
        'shielded',
        saved.shielded,
        (blob) => w.restore(blob),
        () => w.startWithSecretKeys(shieldedSecretKeys),
      );
    },
    unshielded: (c: never) => {
      const w = UnshieldedWallet({
        ...(c as object),
        txHistoryStorage: new NoOpTransactionHistoryStorage(),
      } as never);
      return restoreOrStart(
        stateDir,
        'unshielded',
        saved.unshielded,
        (blob) => w.restore(blob),
        () => w.startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      );
    },
    dust: (c: never) => {
      const w = DustWallet({
        ...(c as object),
        costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
        txHistoryStorage: new NoOpTransactionHistoryStorage(),
      } as never);
      return restoreOrStart(
        stateDir,
        'dust',
        saved.dust,
        (blob) => w.restore(blob),
        () =>
          w.startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
      );
    },
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  const persistMs = envInt('MN_WALLET_PERSIST_MS', 30_000);
  const stopPersist =
    persistMs > 0 ? startPersistence(wallet, stateDir, persistMs) : undefined;

  return { wallet, shieldedSecretKeys, dustSecretKey, keystore, stopPersist };
}

/** Resolves once the wallet reports a completed sync. */
export async function waitForSynced(ctx: WalletCtx): Promise<FacadeState> {
  const state$ = ctx.wallet.state() as unknown as Observable<FacadeState>;
  return firstValueFrom(state$.pipe(filter((s) => s.isSynced === true)));
}

/** Stops persistence and the wallet. Safe to call more than once. */
export async function closeWallet(ctx: WalletCtx): Promise<void> {
  ctx.stopPersist?.();
  await ctx.wallet.stop();
}

// ---------------------------------------------------------------------------
// Transaction signing
// ---------------------------------------------------------------------------

/**
 * Signs the unshielded intents of a transaction in place.
 *
 * Intents are immutable once built, so each one is cloned through
 * deserialization, signed over its own segment's signature data, and written
 * back. Inputs that already carry a signature keep it: re-signing an input
 * signed by someone else would drop their signature.
 */
function signTransactionIntents(
  tx: { intents?: Map<number, unknown> },
  sign: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment) as { serialize(): Uint8Array } | undefined;
    if (!intent) continue;

    const cloned = (ledger.Intent.deserialize as (...args: unknown[]) => never)(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    ) as unknown as {
      signatureData(segment: number): Uint8Array;
      fallibleUnshieldedOffer?: UnshieldedOffer;
      guaranteedUnshieldedOffer?: UnshieldedOffer;
    };

    const signature = sign(cloned.signatureData(segment));
    for (const key of ['fallibleUnshieldedOffer', 'guaranteedUnshieldedOffer'] as const) {
      const offer = cloned[key];
      if (!offer) continue;
      const signatures = offer.inputs.map((_, i) => offer.signatures.at(i) ?? signature);
      (cloned as Record<string, unknown>)[key] = offer.addSignatures(signatures);
    }

    tx.intents.set(segment, cloned);
  }
}

interface UnshieldedOffer {
  inputs: unknown[];
  signatures: { at(index: number): ledger.Signature | undefined };
  addSignatures(signatures: ledger.Signature[]): unknown;
}

/**
 * Adapter exposing the wallet as the balance/sign/submit provider the contract
 * layer expects.
 */
export function makeWalletProvider(ctx: WalletCtx, state: FacadeState) {
  const defaultTtl = () => new Date(Date.now() + 30 * 60 * 1000);

  return {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),

    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx as never,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? defaultTtl() },
      );

      const sign = (payload: Uint8Array) => ctx.keystore.signData(payload);
      const parts = recipe as unknown as {
        baseTransaction: { intents?: Map<number, unknown> };
        balancingTransaction?: { intents?: Map<number, unknown> };
      };

      // The base transaction is already proven; the balancing one is not yet.
      // The marker has to match, or deserialization rejects the intent.
      signTransactionIntents(parts.baseTransaction, sign, 'proof');
      if (parts.balancingTransaction) {
        signTransactionIntents(parts.balancingTransaction, sign, 'pre-proof');
      }

      return ctx.wallet.finalizeRecipe(recipe);
    },

    submitTx: (tx: unknown) => ctx.wallet.submitTransaction(tx as never) as Promise<string>,
  };
}

// ---------------------------------------------------------------------------
// Provider set
// ---------------------------------------------------------------------------

export type AmparoProviders = MidnightProviders<CircuitId, typeof PRIVATE_STATE_ID, unknown>;

/** Assembles the full provider set from a wallet that has finished syncing. */
export async function buildProviders(
  ctx: WalletCtx,
  config: MidnightConfig = loadConfig(),
): Promise<AmparoProviders> {
  const state = await waitForSynced(ctx);
  const walletProvider = makeWalletProvider(ctx, state);
  const zk = zkConfigProvider(config);

  return {
    privateStateProvider: levelPrivateStateProvider({
      // A store NAME, not a path: the database is created relative to the
      // working directory, which for every npm script here is the package root.
      // It is named explicitly so the .gitignore entry and this line cannot
      // drift apart - the directory holds the authority credential, and an
      // entry that no longer matches the real name would let it be committed.
      privateStateStoreName: PRIVATE_STATE_STORE,
      walletProvider,
      // Encrypts the local private-state database. The default is a fixed
      // development value; anything holding a real credential must set
      // MN_PRIVATE_STATE_PASSWORD.
      //
      // The provider enforces a policy: at least 16 characters drawn from 3 of
      // {uppercase, lowercase, digits, symbols}. A password that fails it throws
      // during the first write, which is in the middle of a deployment - so the
      // default below deliberately satisfies the policy rather than being the
      // shortest thing that reads as a placeholder.
      privateStoragePasswordProvider: () =>
        process.env.MN_PRIVATE_STATE_PASSWORD ?? 'Amparo-Local-Dev-2026!',
      // Keeps private state of different wallets apart on a shared machine.
      accountId: state.shielded.coinPublicKey.toHexString(),
    } as never),
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(config.proofServerUrl, zk as never),
    walletProvider: walletProvider as never,
    midnightProvider: walletProvider as never,
  } as AmparoProviders;
}

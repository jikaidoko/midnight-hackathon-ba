// wallet-provider.ts - balancing, signing and submitting, with nothing from Node.
//
// This is the half of the wallet layer a BROWSER can also use. It was split out
// of `providers.ts`, which reads saved sync state off disk and therefore drags
// `node:fs`, `node:path` and `node:crypto` into whoever imports it - and a
// module that imports those is unusable from a page, however pure the function
// being called. The symptom of getting that wrong is not an error in the
// function: it is a cascade of `Cannot find module 'node:path'` in a file nobody
// touched.
//
// So the rule this file encodes: everything here runs anywhere a wallet facade
// runs. Building the wallet - where the seed comes from, whether sync state is
// restored, where it is stored - belongs to the caller, because that is the part
// that differs between a script and a page. `providers.ts` re-exports all of
// this, so existing callers see no change.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

type Keystore = ReturnType<typeof createKeystore>;

/** A built wallet plus the key material needed to balance and sign. */
export interface WalletCtx {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  keystore: Keystore;
  /** Stops any periodic state save. Absent where there is nowhere to save to. */
  stopPersist?: () => void;
}

/** Shape of the facade state the callers read. */
export interface FacadeState {
  isSynced: boolean;
  shielded: {
    coinPublicKey: { toHexString(): string };
    encryptionPublicKey: { toHexString(): string };
  };
}

interface UnshieldedOffer {
  inputs: unknown[];
  signatures: { at(index: number): ledger.Signature | undefined };
  addSignatures(signatures: ledger.Signature[]): unknown;
}

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

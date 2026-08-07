// deploy.ts - deploys the Amparo contract.
//
//   npm run mn:up          start the local network
//   npm run mn:health      confirm all three services answer
//   npm run compile        emit src/managed/
//   npm run check-wallet   confirm the wallet syncs
//   npm run deploy         threshold 3
//   npm run deploy -- 2    threshold 2
//
// The deployment itself generates a zero-knowledge proof - the constructor's -
// so a successful run also proves the proof server is working, which no cheaper
// check does.
//
// Two values are decided here and cannot be changed afterwards:
//
//   authorityCommitment  whoever knows its preimage can admit cases. It is
//                        computed through the contract's own exported pure
//                        circuit, never reimplemented.
//   reviewThreshold      how many independent reports move a case to review.
//                        `sealed`, so the compiler forbids rewriting it - and
//                        sealed fields are absent from the generated Ledger
//                        projection, so no client can read it back either. The
//                        deployment record below is the only copy.
//
// There is no genesis root any more. It existed to seed a display-only mirror
// of the registry root, which is gone along with the second contract.
//
// The generated authority secret is written to a gitignored deployment file. It
// is a demo credential for a test network, and it is still the only thing that
// gates admission: treat the file as sensitive and do not commit it.

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, describe, PKG_ROOT } from '../src/midnight/config.js';
import {
  buildWallet,
  buildProviders,
  waitForSynced,
  closeWallet,
} from '../src/midnight/providers.js';
import { AMPARO } from '../src/midnight/contracts.js';
import { amparoContract, authorityCommitment } from '../src/midnight/compiled-contract.js';
import { positionals, toHex } from '../src/midnight/subjects.js';
import { createAuthorityState } from '../src/amparo-witnesses.js';

const config = loadConfig();
const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);

const [thresholdArg] = positionals();
const threshold = BigInt(thresholdArg ?? process.env.MN_REVIEW_THRESHOLD ?? '3');
if (threshold < 1n) throw new Error(`review threshold must be at least 1 (got ${threshold})`);

console.log(describe(config));
console.log('');

// 1. Authority credential. Random per deployment: a fixed secret in a public
//    repository would let anyone admit cases against this deployment.
const authoritySecret = Uint8Array.from(randomBytes(32));
const commitment = authorityCommitment(authoritySecret);
console.log(`Authority commitment: ${toHex(commitment)}`);
console.log(`Review threshold:     ${threshold}`);

// 2. Wallet, then providers. Deploying before the wallet has synced fails while
//    balancing, with an error that points at funds rather than at timing.
const ctx = await buildWallet(config);
const state = await waitForSynced(ctx);
console.log(`Wallet synced:        ${state.shielded.coinPublicKey.toHexString().slice(0, 24)}...`);

const providers = await buildProviders(ctx, config, AMPARO);

console.log('\nDeploying (this generates the constructor proof)...');
const deployed = await deployContract(providers as never, {
  compiledContract: amparoContract(config, AMPARO) as never,
  args: [commitment, threshold],
  privateStateId: AMPARO.privateStateId,
  initialPrivateState: createAuthorityState(authoritySecret),
} as never);

const contractAddress = (
  deployed as { deployTxData: { public: { contractAddress: string } } }
).deployTxData.public.contractAddress;

console.log(`\nDeployed at ${contractAddress}`);

// 3. Persist what the follow-up scripts need. The admitted-case log is gone: it
//    existed so an off-chain mirror could replay insertions in order and predict
//    the next root, and nothing predicts roots any more. Everything except the
//    threshold is readable from the chain, and a local copy of chain state is a
//    second source that can only drift.
writeFileSync(
  deploymentFile,
  JSON.stringify(
    {
      network: config.networkId,
      contractAddress,
      authoritySecret: toHex(authoritySecret),
      reviewThreshold: threshold.toString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${deploymentFile}`);
console.log('This file holds the authority secret. It is gitignored; keep it that way.');

await closeWallet(ctx);
process.exit(0);

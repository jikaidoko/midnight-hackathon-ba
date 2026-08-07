// deploy.ts - deploys the case admission contract.
//
//   npm run mn:up          start the local network
//   npm run mn:health      confirm all three services answer
//   npm run compile        emit src/managed/ (runs under WSL)
//   npm run check-wallet   confirm the wallet syncs
//   npm run deploy
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
//   genesisRoot          root of the empty tree, so the display mirror is
//                        honest from block zero instead of starting at a
//                        meaningless default.
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
import { CASE_ADMISSION } from '../src/midnight/contracts.js';
import { amparoContract, authorityCommitment } from '../src/midnight/compiled-contract.js';
import { createCaseRegistry, toHex } from '../src/case-registry.js';
import type { AuthorityPrivateState } from '../src/witnesses.js';

const config = loadConfig();
const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);

console.log(describe(config));
console.log('');

// 1. Authority credential. Random per deployment: a fixed secret in a public
//    repository would let anyone admit cases against this deployment.
const authoritySecret = Uint8Array.from(randomBytes(32));
const commitment = authorityCommitment(authoritySecret);
console.log(`Authority commitment: ${toHex(commitment)}`);

// 2. Empty-tree root, from the same implementation that backs the ledger ADT.
const registry = createCaseRegistry();
const genesisRoot = registry.root();
console.log(`Genesis root:         ${genesisRoot.field.toString()}`);

// 3. Wallet, then providers. Deploying before the wallet has synced fails while
//    balancing, with an error that points at funds rather than at timing.
const ctx = await buildWallet(config);
const state = await waitForSynced(ctx);
console.log(`Wallet synced:        ${state.shielded.coinPublicKey.toHexString().slice(0, 24)}...`);

const providers = await buildProviders(ctx, config, CASE_ADMISSION);

const initialPrivateState: AuthorityPrivateState = { authoritySecret };

console.log('\nDeploying (this generates the constructor proof)...');
const deployed = await deployContract(providers as never, {
  compiledContract: amparoContract(config) as never,
  args: [commitment, genesisRoot],
  privateStateId: CASE_ADMISSION.privateStateId,
  initialPrivateState,
} as never);

const contractAddress = (
  deployed as { deployTxData: { public: { contractAddress: string } } }
).deployTxData.public.contractAddress;

console.log(`\nDeployed at ${contractAddress}`);

// 4. Persist what the follow-up scripts need. `admittedCases` is the ordered log
//    of admissions, which is what lets the off-chain mirror be rebuilt later:
//    the mirror has to replay insertions in the same order the contract saw them
//    to predict the next root.
writeFileSync(
  deploymentFile,
  JSON.stringify(
    {
      network: config.networkId,
      contractAddress,
      authoritySecret: toHex(authoritySecret),
      admittedCases: [] as string[],
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${deploymentFile}`);
console.log('This file holds the authority secret. It is gitignored; keep it that way.');

await closeWallet(ctx);
process.exit(0);

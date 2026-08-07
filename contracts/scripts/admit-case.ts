// admit-case.ts - admits one case against a deployed contract.
//
//   npm run deploy
//   npm run admit-case                 admit a random case commitment
//   npm run admit-case -- <64 hex>     admit a specific one
//
// This is the authority half: private witness in, client-side proof, public
// state out. `npm run deploy` proves the constructor circuit works; this proves
// the gated circuit does, which is the one the product depends on.
//
// It used to end by comparing an off-chain mirror against the real tree, because
// `admitCase` received the post-insertion root as a parameter it could not
// verify - `root()` is runtime-only - and an off-chain computation error would
// publish a mirror that lies while every transaction succeeds. That parameter is
// gone with the second contract, so there is no second source to reconcile and
// nothing for the authority to declare. The tree advances or the transaction
// fails.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, describe, PKG_ROOT } from '../src/midnight/config.js';
import {
  buildWallet,
  buildProviders,
  waitForSynced,
  closeWallet,
} from '../src/midnight/providers.js';
import { AMPARO } from '../src/midnight/contracts.js';
import { amparoContract, ledger } from '../src/midnight/compiled-contract.js';
import { positionals, fromHex, toHex } from '../src/midnight/subjects.js';
import { createAuthorityState } from '../src/amparo-witnesses.js';

interface DeploymentFile {
  network: string;
  contractAddress: string;
  authoritySecret: string;
  reviewThreshold: string;
}

const config = loadConfig();
const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);

if (!existsSync(deploymentFile)) {
  throw new Error(`No deployment found at ${deploymentFile}. Run \`npm run deploy\` first.`);
}
const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile;

const [argHex] = positionals();
const caseCommitment = argHex
  ? fromHex(argHex, 'case commitment')
  : Uint8Array.from(randomBytes(32));

console.log(describe(config));
console.log(`\nContract: ${deployment.contractAddress}`);
console.log(`Case:     ${toHex(caseCommitment)}`);

const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config, AMPARO);

// The credential reaches the circuit through the private state provider, not
// through this script: the witness reads it from there. Handing it to
// `findDeployedContract` as `initialPrivateState` is what stores it. Writing it
// to the provider directly beforehand fails - private state is keyed by contract
// address, and the address is only bound once the contract is found.
const contract = await findDeployedContract(providers as never, {
  contractAddress: deployment.contractAddress,
  compiledContract: amparoContract(config, AMPARO),
  privateStateId: AMPARO.privateStateId,
  initialPrivateState: createAuthorityState(
    fromHex(deployment.authoritySecret, 'authority secret'),
  ),
} as never);

console.log('\nAdmitting (this generates a proof; the first one is slower)...');
const called = await (
  contract as unknown as {
    callTx: { admitCase(c: Uint8Array): Promise<{ public: { txId: string } }> };
  }
).callTx.admitCase(caseCommitment);

console.log(`Transaction ${called.public.txId}`);

const rawState = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
if (!rawState) throw new Error('Contract state could not be read back after admission');
const publicState = ledger(rawState.data);

console.log(`\nAdmitted count: ${publicState.admittedCount}`);
console.log(`Registry root:  ${publicState.admittedCases.root().field.toString()}`);
console.log(`In registry:    ${publicState.admittedIndex.member(caseCommitment) ? 'yes' : 'NO'}`);

await closeWallet(ctx);
process.exit(0);

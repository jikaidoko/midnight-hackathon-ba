// respond-case.ts - records the control body's answer to an escalated case.
//
//   npm run respond-case -- <64 hex case> investigation "Opened case file 41/2026."
//   npm run respond-case -- <64 hex case> dismissal "Outside our remit." --detail "..."
//
// The authority half again, and the last circuit without a driver. That gap was
// worth closing on its own: a circuit nobody can run has never produced a real
// proof, and everything known about it comes from a simulator that does not
// generate one. The three guards it carries - authority, threshold, write-once -
// are only claims until a proof server accepts them.
//
// `grounds` is the mandatory half of the answer and is encoded here rather than
// passed through: the circuit wants a fixed `Bytes<256>` and the caller has a
// sentence. `encodeGrounds` refuses text that overflows instead of truncating
// it, which matters more here than anywhere else - this writes a permanent,
// unrewritable ledger entry, so a silent cut would be published forever.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
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
import { encodeGrounds, decodeGrounds, ResponseKind } from '../src/midnight/ledger.js';
import { derivePublicView } from '../src/midnight/derived-state.js';

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

// Spelled out rather than indexed by number. The enum's numeric values are an
// encoding detail; a command line that takes `1` invites recording a referral
// when an investigation was meant, and the entry cannot be rewritten.
const KINDS: Record<string, ResponseKind> = {
  investigation: ResponseKind.investigation,
  referral: ResponseKind.referral,
  dismissal: ResponseKind.dismissal,
};

const [argCase, argKind, argGrounds] = positionals();

if (!argCase || !argKind || !argGrounds) {
  throw new Error(
    'usage: npm run respond-case -- <64 hex case> <investigation|referral|dismissal> ' +
      '"<grounds>" [--detail "<longer explanation>"]',
  );
}

const caseCommitment = fromHex(argCase, 'case commitment');

const kind = KINDS[argKind];
if (kind === undefined) {
  throw new Error(`unknown response kind "${argKind}" (expected ${Object.keys(KINDS).join(', ')})`);
}

const detailFlag = process.argv.indexOf('--detail');
const detail = detailFlag === -1 ? '' : (process.argv[detailFlag + 1] ?? '');

// Encoded before the wallet is built, so an overlong or empty line fails now
// rather than after a sync and a proof.
const grounds = encodeGrounds(argGrounds);

console.log(describe(config));
console.log(`\nContract: ${deployment.contractAddress}`);
console.log(`Case:     ${toHex(caseCommitment)}`);
console.log(`Kind:     ${argKind}`);
console.log(`Grounds:  ${argGrounds}`);
if (detail) console.log(`Detail:   ${detail}`);

const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config, AMPARO);

const contract = await findDeployedContract(providers as never, {
  contractAddress: deployment.contractAddress,
  compiledContract: amparoContract(config, AMPARO),
  privateStateId: AMPARO.privateStateId,
  initialPrivateState: createAuthorityState(
    fromHex(deployment.authoritySecret, 'authority secret'),
  ),
} as never);

console.log('\nAnswering (this generates a proof; the first one is slower)...');
const called = await (
  contract as unknown as {
    callTx: {
      respondToCase(
        c: Uint8Array,
        k: ResponseKind,
        g: Uint8Array,
        d: string,
      ): Promise<{ public: { txId: string } }>;
    };
  }
).callTx.respondToCase(caseCommitment, kind, grounds, detail);

console.log(`Transaction ${called.public.txId}`);

const rawState = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
if (!rawState) throw new Error('Contract state could not be read back after the response');
const publicState = ledger(rawState.data);

const recorded = publicState.caseResponses.member(caseCommitment)
  ? publicState.caseResponses.lookup(caseCommitment)
  : undefined;

console.log(`\nRecorded:       ${recorded ? 'yes' : 'NO'}`);
if (recorded) {
  console.log(`Grounds on chain: ${decodeGrounds(recorded.grounds)}`);
  console.log(`Detail on chain:  ${recorded.detail || '(none)'}`);
}

// The backlog, printed from the same function a public dashboard renders. That
// it is the SAME function is the point: a driver with its own copy of the
// derivation proves the driver, not the thing the audience will look at.
const oversight = derivePublicView(publicState, BigInt(deployment.reviewThreshold));
console.log(`\nEscalated:        ${oversight.underReviewCount}`);
console.log(`Still unanswered: ${oversight.unanswered.length}`);
for (const c of oversight.unanswered) {
  console.log(`  - ${c.caseCommitment} (${c.reports} reports, no answer on chain)`);
}

await closeWallet(ctx);
process.exit(0);

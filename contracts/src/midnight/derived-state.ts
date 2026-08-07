// derived-state.ts - the view a reporter's UI needs, computed from the
// contract's public state plus the reporter's own secret.
//
// The scripts read state one shot at a time, after a transaction they just sent.
// A UI cannot work that way: it has to know, before offering a button, whether
// pressing it would succeed. Every question below is one the interface has to
// answer up front, and none of them can be answered by the chain alone.
//
//   have I already filed against this case?   nullifier derived from MY secret
//   can I present a credential?               how many of MY nullifiers are on chain
//
// That is the shape of the pattern: public ledger state is not the view. The
// view is public state joined with a private value, and the join happens on the
// client because the private value never leaves it.
//
// The join is a pure function - `deriveReporterView` - and the observable is a
// thin wrapper over it. That split is deliberate: the interesting logic is then
// testable in the simulator with no network, no wallet and no proof server,
// which is the only way it gets tested at all during a hackathon.
//
// This got SIMPLER when the two contracts became one. It used to take both
// contracts' state and expose a `registryDiverged` flag, because the filing side
// froze the admitted root at construction and a later admission made every case
// unfilable. There is one contract and no frozen root, so there is one stream
// and no divergence to report.

import { map, type Observable } from 'rxjs';
import { ledger, filingNullifier, type AmparoLedger } from './compiled-contract.js';

/** One admitted case, as this particular reporter sees it. */
export interface CaseView {
  /** 32-byte case commitment, hex. */
  readonly caseCommitment: string;
  /** Public corroboration count. Visible to everyone. */
  readonly reports: bigint;
  /** Public flag: the case crossed the review threshold. */
  readonly underReview: boolean;
  /** Private to this reporter: their nullifier for this case is on chain. */
  readonly hasFiled: boolean;
  /** Filing now would be accepted: admitted, and not already filed by them. */
  readonly canFile: boolean;
}

export interface ReporterView {
  readonly cases: readonly CaseView[];
  /** Filings by THIS reporter, counted from the chain rather than trusted. */
  readonly myFilingCount: number;
  readonly canPresentCredential: boolean;
  readonly reviewThreshold: bigint;
  /** Cases the authority has admitted, in total. */
  readonly admittedCount: bigint;
}

/** Filings a credential needs. Matches the arity of `proveRepeatFilings`. */
export const CREDENTIAL_FILINGS = 3;

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Joins the contract's public state with one reporter's secret.
 *
 * `threshold` is passed in because it cannot be read: `reviewThreshold` is a
 * `sealed` ledger field and sealed fields are absent from the generated Ledger
 * projection. It comes from the deployment record.
 *
 * Counting filings from the chain rather than from a local tally is the same
 * decision the circuit makes, for the same reason: a count the client keeps is a
 * count the client can be wrong about, and here being wrong means offering a
 * credential button that produces a failing proof.
 */
export function deriveReporterView(
  state: AmparoLedger,
  secret: Uint8Array,
  threshold: bigint,
): ReporterView {
  const cases: CaseView[] = [];
  let myFilingCount = 0;

  // `admittedIndex` is the enumerable registry. Iterating the ADT directly is
  // also what keeps this honest: `JSON.stringify` over a ledger ADT yields `{}`
  // even when it is populated.
  for (const caseCommitment of state.admittedIndex) {
    const nullifier = filingNullifier(secret, caseCommitment);
    const hasFiled = state.spentFilingNullifiers.member(nullifier);
    if (hasFiled) myFilingCount++;

    cases.push({
      caseCommitment: toHex(caseCommitment),
      reports: state.caseReports.member(caseCommitment)
        ? state.caseReports.lookup(caseCommitment).read()
        : 0n,
      underReview: state.casesUnderReview.member(caseCommitment),
      hasFiled,
      canFile: !hasFiled,
    });
  }

  return {
    cases,
    myFilingCount,
    canPresentCredential: myFilingCount >= CREDENTIAL_FILINGS,
    reviewThreshold: threshold,
    admittedCount: state.admittedCount,
  };
}

export interface ReporterViewSources {
  readonly contractAddress: string;
  readonly secret: Uint8Array;
  readonly reviewThreshold: bigint;
}

interface StateObservableProvider {
  publicDataProvider: {
    contractStateObservable(
      address: string,
      config: { type: 'latest' },
    ): Observable<{ data: unknown }>;
  };
}

/** Live view: re-emits whenever the contract's state changes. */
export function reporterView$(
  providers: StateObservableProvider,
  sources: ReporterViewSources,
): Observable<ReporterView> {
  return providers.publicDataProvider
    .contractStateObservable(sources.contractAddress, { type: 'latest' })
    .pipe(
      map((raw) =>
        deriveReporterView(
          ledger(raw.data as never),
          sources.secret,
          sources.reviewThreshold,
        ),
      ),
    );
}

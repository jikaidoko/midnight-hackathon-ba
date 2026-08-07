// derived-state.ts - the views a UI renders, computed from the contract's
// public state.
//
// There are two, and the difference between them IS the product:
//
//   deriveReporterView   public state joined with ONE reporter's secret
//   derivePublicView     public state alone, no secret anywhere
//
// The reporter view is below. The public view is at the bottom of this file, and
// it is the one an audience watches: it takes no secret because there is none to
// take, which is why it can be served to anybody without a wallet.
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

// ---------------------------------------------------------------------------
// The public view
// ---------------------------------------------------------------------------
//
// What the chain says about CASES, with no reporter in it.
//
// This is the deliberately public half of the contract. Output B counts reports
// per case and flags a case once enough independent ones converge, and the
// subject of that count is an admitted site or incident, not a person. Privacy
// points at the reporter; transparency points at the institution.
//
// It takes no secret, and that is a structural guarantee rather than a promise
// to be careful: there is no parameter through which a reporter's identity could
// enter, so no version of this function can leak one. `deriveReporterView` needs
// a secret to answer "have I filed?"; nothing here asks a question about a
// person, so nothing here can answer one.
//
// The practical consequence is what makes this view the safe one to run live: it
// needs an indexer and nothing else. No wallet, so no sync and no seed; no proof
// server, because reading proves nothing. Every failure mode that has cost this
// project time belongs to the machinery this view does not use.

/** One admitted case, as anyone at all sees it. */
export interface PublicCaseView {
  /** 32-byte case commitment, hex. Opaque: the registry holds no case detail. */
  readonly caseCommitment: string;
  /** How many distinct reporters have filed against it. */
  readonly reports: bigint;
  /** It crossed the threshold and is flagged for review. */
  readonly underReview: boolean;
  /** Further reports needed to cross. Zero once under review. */
  readonly reportsToReview: bigint;
}

export interface PublicLedgerView {
  /** Every admitted case, in registry order. */
  readonly cases: readonly PublicCaseView[];
  /** Cases the authority has admitted, from the contract's own counter. */
  readonly admittedCount: bigint;
  /** How many of them are flagged. */
  readonly underReviewCount: number;
  /** Every report on the contract, summed across cases. */
  readonly totalReports: bigint;
  readonly reviewThreshold: bigint;
}

/**
 * The public half of the ledger, with no secret involved.
 *
 * `threshold` is passed in for the same reason `deriveReporterView` takes it:
 * `reviewThreshold` is `sealed`, and a sealed field is absent from the generated
 * Ledger projection entirely. The circuit reads it; no client can. It comes from
 * the deployment record.
 *
 * Note what is NOT read here even though it is public: `spentFilingNullifiers`
 * and `filingNullifierTree`. They are on chain and anyone may read them, but a
 * nullifier is the one public value derived from a reporter's secret, so putting
 * them on a screen would publish the only per-person artifact the design has -
 * still unlinkable to a name, but no longer unlinkable to each other across a
 * single reporter's filings. The view stops at the case.
 */
export function derivePublicView(
  state: AmparoLedger,
  threshold: bigint,
): PublicLedgerView {
  const cases: PublicCaseView[] = [];
  let totalReports = 0n;
  let underReviewCount = 0;

  for (const caseCommitment of state.admittedIndex) {
    const reports = state.caseReports.member(caseCommitment)
      ? state.caseReports.lookup(caseCommitment).read()
      : 0n;
    const underReview = state.casesUnderReview.member(caseCommitment);

    totalReports += reports;
    if (underReview) underReviewCount++;

    cases.push({
      caseCommitment: toHex(caseCommitment),
      reports,
      underReview,
      // Clamped rather than subtracted blind. The circuit avoids the same
      // subtraction for a harder reason - it would underflow on Uint - and the
      // clamp keeps this readable as "none left to go" past the bar.
      reportsToReview: reports >= threshold ? 0n : threshold - reports,
    });
  }

  return {
    cases,
    admittedCount: state.admittedCount,
    underReviewCount,
    totalReports,
    reviewThreshold: threshold,
  };
}

export interface PublicViewSources {
  readonly contractAddress: string;
  readonly reviewThreshold: bigint;
}

/**
 * Live public view: re-emits whenever the contract's state changes.
 *
 * Same subscription the reporter view uses, and deliberately so - the flag
 * flipping on screen is the same event the chain published, not a poll that
 * happened to catch it.
 */
export function publicView$(
  providers: StateObservableProvider,
  sources: PublicViewSources,
): Observable<PublicLedgerView> {
  return providers.publicDataProvider
    .contractStateObservable(sources.contractAddress, { type: 'latest' })
    .pipe(
      map((raw) =>
        derivePublicView(ledger(raw.data as never), sources.reviewThreshold),
      ),
    );
}

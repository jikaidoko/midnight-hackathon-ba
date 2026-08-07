// derived-state.ts - the view a reporter's UI needs, computed from both
// contracts' public state plus the reporter's own secret.
//
// The scripts read state one shot at a time, after a transaction they just sent.
// A UI cannot work that way: it has to know, before offering a button, whether
// pressing it would succeed. Every question below is one the interface has to
// answer up front, and none of them can be answered by the chain alone.
//
//   have I already filed against this case?   nullifier derived from MY secret
//   can I present a credential?               how many of MY nullifiers are on chain
//   is this case under review?                public, but paired with the above
//
// That is the shape of the pattern: public ledger state is not the view. The
// view is public state joined with a private value, and the join happens on the
// client because the private value never leaves it.
//
// The join is a pure function - `deriveReporterView` - and the observable is a
// thin wrapper over it. That split is deliberate: the interesting logic is then
// testable in the simulator with no network, no wallet and no proof server,
// which is the only way it gets tested at all during a hackathon.

import { combineLatest, map, type Observable } from 'rxjs';
import {
  caseLedger,
  filingLedger,
  filingNullifier,
  type CaseAdmissionLedger,
  type FilingRegistryLedger,
} from './compiled-contract.js';

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
  /** Filing now would be accepted: admitted, not already filed, roots agree. */
  readonly canFile: boolean;
}

export interface ReporterView {
  readonly cases: readonly CaseView[];
  /** Filings by THIS reporter, counted from the chain rather than trusted. */
  readonly myFilingCount: number;
  readonly canPresentCredential: boolean;
  readonly reviewThreshold: bigint;
  /** Root frozen into the filing registry at construction. */
  readonly admittedRootFrozen: bigint;
  /** Root the admission registry has right now. */
  readonly admittedRootLive: bigint;
  /**
   * The two have diverged, so no case can be filed against until the filing
   * registry is redeployed. The UI has to say this rather than let every filing
   * fail with "Case is not in the admitted registry".
   */
  readonly registryDiverged: boolean;
}

/** Filings a credential needs. Matches the arity of `proveRepeatFilings`. */
export const CREDENTIAL_FILINGS = 3;

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Joins both contracts' public state with one reporter's secret.
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
  caseState: CaseAdmissionLedger,
  filingState: FilingRegistryLedger,
  secret: Uint8Array,
  threshold: bigint,
): ReporterView {
  const admittedRootLive = caseState.admittedCases.root().field;
  const admittedRootFrozen = filingState.admittedRoot.field;
  const registryDiverged = admittedRootLive !== admittedRootFrozen;

  const cases: CaseView[] = [];
  let myFilingCount = 0;

  // `admittedIndex` is the enumerable companion to the Merkle tree, which is
  // not iterable. Iterating the ADT directly is also what keeps this honest:
  // `JSON.stringify` over a ledger ADT yields `{}` even when it is populated.
  for (const caseCommitment of caseState.admittedIndex) {
    const nullifier = filingNullifier(secret, caseCommitment);
    const hasFiled = filingState.spentFilingNullifiers.member(nullifier);
    if (hasFiled) myFilingCount++;

    cases.push({
      caseCommitment: toHex(caseCommitment),
      reports: filingState.caseReports.member(caseCommitment)
        ? filingState.caseReports.lookup(caseCommitment).read()
        : 0n,
      underReview: filingState.casesUnderReview.member(caseCommitment),
      hasFiled,
      canFile: !hasFiled && !registryDiverged,
    });
  }

  return {
    cases,
    myFilingCount,
    canPresentCredential: myFilingCount >= CREDENTIAL_FILINGS,
    reviewThreshold: threshold,
    admittedRootFrozen,
    admittedRootLive,
    registryDiverged,
  };
}

export interface ReporterViewSources {
  readonly caseAdmissionAddress: string;
  readonly filingRegistryAddress: string;
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

/**
 * Live view: re-emits whenever either contract's state changes.
 *
 * Both streams are needed. A filing changes the filing registry; an admission
 * changes the admission registry and can silently make every case unfileable by
 * moving the root out from under the frozen one. Watching only the contract the
 * user is acting on would leave the interface confidently wrong.
 */
export function reporterView$(
  providers: StateObservableProvider,
  sources: ReporterViewSources,
): Observable<ReporterView> {
  const cases$ = providers.publicDataProvider.contractStateObservable(
    sources.caseAdmissionAddress,
    { type: 'latest' },
  );
  const filings$ = providers.publicDataProvider.contractStateObservable(
    sources.filingRegistryAddress,
    { type: 'latest' },
  );

  return combineLatest([cases$, filings$]).pipe(
    map(([rawCases, rawFilings]) =>
      deriveReporterView(
        caseLedger(rawCases.data as never),
        filingLedger(rawFilings.data as never),
        sources.secret,
        sources.reviewThreshold,
      ),
    ),
  );
}

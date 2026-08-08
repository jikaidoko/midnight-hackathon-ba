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

import {
  debounceTime,
  map,
  repeat,
  retry,
  tap,
  timeout,
  type MonoTypeOperatorFunction,
  type Observable,
} from 'rxjs';
import {
  ledger, filingNullifier, decodeGrounds, ResponseKind, type AmparoLedger,
} from './ledger.js';

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

// Written by hand rather than with `Buffer`, which does not exist in a browser.
// This module is the one piece of the harness a UI imports directly, so a Node
// global here is not a style question: it is the difference between the view
// running where it was designed to run and failing at load. Nothing else in
// this file touches a Node API, and nothing else should.
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * How many reports a case has, including none.
 *
 * `Map<K, Counter>` does not auto-initialise: a case nobody has reported has no
 * entry at all, and `lookup` on a missing key fails rather than returning zero.
 * It is the same asymmetry `registerFiling` handles with an `insert` before its
 * first `increment`, and it is why both views ask `member` first. Shared so the
 * two cannot drift into disagreeing about what an unreported case reads as.
 */
function reportsFor(state: AmparoLedger, caseCommitment: Uint8Array): bigint {
  return state.caseReports.member(caseCommitment)
    ? state.caseReports.lookup(caseCommitment).read()
    : 0n;
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
      reports: reportsFor(state, caseCommitment),
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

// ---------------------------------------------------------------------------
// Keeping a chain subscription alive
// ---------------------------------------------------------------------------
//
// The indexer's state stream ENDS ON ITS OWN, and this is the single most
// expensive thing to learn about it, because it ends in the one way that looks
// like success. Instrumenting next/error/complete against a stopped indexer:
//
//     +0.2s  NEXT
//     +10.0s COMPLETE
//
// Not an error, so nothing retries it. Not silence, so nothing times it out. A
// bare `contractStateObservable(...).pipe(map(...))` therefore stops forever
// after any indexer hiccup, while every other signal stays green - no error, no
// log, no gap a caller can notice. The UI goes on rendering its last snapshot
// with total authority, which for the reporter's view means a person watching
// their own filings silently stop appearing.
//
// Both views need this, so it lives here rather than in either caller. It was
// first written inside the public-ledger script, where the fault was found; a
// copy there and a missing one here is exactly how the reporter's view would
// have kept the bug after it was understood.

/** How a stream ended, for a caller that wants to surface it. */
export type StreamEnding =
  | { readonly kind: 'complete' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'error'; readonly message: string };

export interface LivenessOptions {
  /**
   * Silence longer than this is treated as a dead socket and becomes a
   * TimeoutError the reconnect can act on. It also bounds staleness: a view can
   * never be older than one reconnect cycle, because a stream that has heard
   * nothing for this long is torn down and re-read.
   */
  readonly heartbeatMs?: number;
  /** Pause before resubscribing, so a dead indexer is polled rather than spun on. */
  readonly reconnectMs?: number;
  /**
   * Quiet period an emission must survive before it is passed on.
   *
   * A resubscribe does not resume where the last one stopped: the indexer
   * REPLAYS past states, so a reconnect arrives as a burst that walks the
   * counters backwards and then forwards again. Measured, from one rebuild on a
   * chain that was already at twelve reports:
   *
   *     [9:07:03] 10 reports
   *     [9:07:03] 11 reports
   *     [9:07:03] 12 reports
   *
   * On a screen that is a number jumping backwards. Collapsing the burst to its
   * last value is what makes a reconnect invisible, which is the whole point of
   * reconnecting automatically.
   */
  readonly settleMs?: number;
  /** Notified on every ending, before the resubscribe. */
  readonly onReconnect?: (ending: StreamEnding) => void;
}

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 2_000;
const DEFAULT_SETTLE_MS = 250;

/**
 * Makes a chain subscription survive its own endings.
 *
 * Three operators for three different endings, and no two of them are
 * interchangeable:
 *
 *   repeat    completion - the one actually observed against this indexer
 *   retry     error      - a bad address, a rejected query
 *   timeout   silence    - a socket still open and no longer delivering, which
 *                          neither of the other two would ever notice
 *
 * Order matters. `timeout` sits innermost so that each resubscribe rebuilds it;
 * above `retry`/`repeat` it would be armed once and never again.
 *
 * A caller that counts emissions should know that every resubscribe re-emits
 * current state - `contractStateObservable` replays the latest state to a new
 * subscriber - so an emission is not by itself evidence that anything changed.
 * Compare before counting.
 */
export function keepAlive<T>(options: LivenessOptions = {}): MonoTypeOperatorFunction<T> {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const notify = options.onReconnect;

  return (source) =>
    source.pipe(
      timeout({ each: heartbeatMs }),
      tap({
        error: (err: unknown) => {
          const timedOut = err instanceof Error && err.name === 'TimeoutError';
          notify?.(
            timedOut
              ? { kind: 'timeout' }
              : { kind: 'error', message: err instanceof Error ? err.message : String(err) },
          );
        },
        complete: () => notify?.({ kind: 'complete' }),
      }),
      retry({ delay: reconnectMs }),
      repeat({ delay: reconnectMs }),
      // Last, so it collapses bursts that span a resubscribe - which is exactly
      // where they come from. Above `repeat` it would only ever see one
      // subscription's worth and the replay would pass through untouched.
      debounceTime(settleMs),
    );
}

/**
 * Live view: re-emits whenever the contract's state changes, and rebuilds its
 * subscription whenever that subscription ends. See `keepAlive` for why the
 * second half of that sentence is not optional.
 */
export function reporterView$(
  providers: StateObservableProvider,
  sources: ReporterViewSources,
  liveness: LivenessOptions = {},
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
      keepAlive(liveness),
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
  /**
   * Reports that arrived AFTER the case had already crossed. Zero before it.
   *
   * This is the closest the chain gets to "how long has this been sitting
   * here". The ledger holds no timestamps, so an oversight screen has no way to
   * say "under review for four days" without inventing it - and an invented
   * number on an accountability screen is worse than a missing one. Corroborations
   * that landed after the duty to answer began is a real quantity, and it says
   * the same thing: people kept reporting while nothing happened.
   *
   * Read together with `answered` below, the pair is the whole accountability
   * claim: how loudly the case was reported, and whether anyone replied.
   */
  readonly reportsAfterEscalation: bigint;
  /**
   * The control body has recorded an answer to this case.
   *
   * False on a case that never escalated too, where it means nothing: nobody
   * has asked the body to act yet. Only `underReview && !answered` is silence.
   */
  readonly answered: boolean;
  /** Present only once answered. */
  readonly kind?: ResponseKind;
  /** The mandatory grounds, decoded out of their fixed-width padding. */
  readonly grounds?: string;
  /** The unbounded half. Empty string when the body wrote only grounds. */
  readonly detail?: string;
}

export interface PublicLedgerView {
  /**
   * Every admitted case, in the order `admittedIndex` yields them.
   *
   * That is NOT insertion order, and the distinction is worth the sentence:
   * admitting A, B, C then LATE iterates as B, C, LATE, A. Anything that needs a
   * meaningful sequence has to impose one — which is what the two groups below
   * are for.
   */
  readonly cases: readonly PublicCaseView[];
  /**
   * Escalated, and therefore the control body's to answer. Most corroborated
   * first.
   *
   * A partition of `cases` rather than a replacement for it. Registry order is
   * the ledger's own and stays available; these two are for the screen that
   * works the backlog as a queue, where the case eleven people reported must
   * not sit below whichever commitment the registry happened to yield first.
   */
  readonly underReview: readonly PublicCaseView[];
  /** Admitted but not yet escalated. Most corroborated first. */
  readonly approaching: readonly PublicCaseView[];
  /** Cases the authority has admitted, from the contract's own counter. */
  readonly admittedCount: bigint;
  /** How many of them are flagged. */
  readonly underReviewCount: number;
  /**
   * THE observable: escalated, and no answer on chain.
   *
   * Each one is a case the control body was publicly told about and has not
   * addressed. It is derived from an ABSENCE - the kind of fact no chain emits
   * and no event log contains - so it exists only once something computes it.
   * That is why it is a field of the view and not left to each caller: a
   * guarantee every screen has to remember to derive is one some screen will
   * forget, and the forgetting looks like there being nothing to show.
   */
  readonly unanswered: readonly PublicCaseView[];
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
    const reports = reportsFor(state, caseCommitment);
    const underReview = state.casesUnderReview.member(caseCommitment);

    totalReports += reports;
    if (underReview) underReviewCount++;

    const response = state.caseResponses.member(caseCommitment)
      ? state.caseResponses.lookup(caseCommitment)
      : undefined;

    cases.push({
      caseCommitment: toHex(caseCommitment),
      reports,
      underReview,
      // Clamped rather than subtracted blind. The circuit avoids the same
      // subtraction for a harder reason - it would underflow on Uint - and the
      // clamp keeps this readable as "none left to go" past the bar.
      reportsToReview: reports >= threshold ? 0n : threshold - reports,
      // Gated on the contract's flag, not on the arithmetic alone. A case can
      // in principle be flagged at a count this subtraction does not predict,
      // and a negative "reports after escalation" would be rendered verbatim by
      // a screen that has no reason to distrust it.
      reportsAfterEscalation: underReview && reports > threshold ? reports - threshold : 0n,
      answered: response !== undefined,
      // Spread rather than assigned, so an unanswered case has no `grounds` key
      // at all. `grounds: undefined` and `grounds: ''` both render as blank, and
      // one of those means "said nothing" while the other means "was never
      // asked" - the distinction this view exists to keep.
      ...(response
        ? {
            kind: response.kind,
            grounds: decodeGrounds(response.grounds),
            detail: response.detail,
          }
        : {}),
    });
  }

  const byReports = (a: PublicCaseView, b: PublicCaseView): number =>
    a.reports === b.reports ? 0 : a.reports > b.reports ? -1 : 1;

  return {
    cases,
    // `sort` mutates, so it is only ever applied to the fresh array `filter`
    // returns. Sorting `cases` directly would silently redefine the field above
    // from "registry order" to whatever the last partition needed.
    underReview: cases.filter((c) => c.underReview).sort(byReports),
    approaching: cases.filter((c) => !c.underReview).sort(byReports),
    admittedCount: state.admittedCount,
    underReviewCount,
    // Escalated and unanswered. Filtered from `cases` rather than collected in
    // the loop so it cannot drift from what the list above shows.
    unanswered: cases.filter((c) => c.underReview && !c.answered),
    totalReports,
    reviewThreshold: threshold,
  };
}

export interface PublicViewSources {
  readonly contractAddress: string;
  readonly reviewThreshold: bigint;
}

/**
 * Live public view: re-emits whenever the contract's state changes, and rebuilds
 * its subscription whenever that subscription ends.
 *
 * Same stream the reporter view uses, and deliberately so - including the same
 * `keepAlive`, because the fault it works around belongs to the stream and not
 * to either view.
 */
export function publicView$(
  providers: StateObservableProvider,
  sources: PublicViewSources,
  liveness: LivenessOptions = {},
): Observable<PublicLedgerView> {
  return providers.publicDataProvider
    .contractStateObservable(sources.contractAddress, { type: 'latest' })
    .pipe(
      map((raw) =>
        derivePublicView(ledger(raw.data as never), sources.reviewThreshold),
      ),
      keepAlive(liveness),
    );
}

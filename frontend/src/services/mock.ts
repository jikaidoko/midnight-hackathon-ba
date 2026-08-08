// mock.ts — the demo's stand-in for a chain, with the same rules.
//
// The point of this file is not to make screens render. It is to make them
// render the SAME transitions the contracts produce, so that swapping in the
// real adapters changes where the data comes from and nothing else.
//
// So the rules are copied from the circuits rather than invented:
//
//   - filing twice against one case is refused          (spentFilingNullifiers)
//   - the credential unlocks at exactly three filings   (proveRepeatFilings)
//   - the review flag flips at the threshold and stays  (casesUnderReview)
//
// A mock that let you file twice, or unlocked the credential at two, would make
// the demo look right and the integration fail later — and it would fail on
// stage, because that is the first time anyone runs the real thing end to end.

import type {
  CaseView,
  CredentialService,
  DisclosureReceipt,
  DisclosureSelection,
  DisclosureService,
  OversightFeed,
  PublicCaseView,
  PublicLedgerView,
  ReporterFeed,
  ReporterView,
  ReportingService,
  ResponseService,
  IdentityService,
  TxResult,
} from './contracts'
import { GROUNDS_BYTES, ResponseKind, groundsByteLength } from './contracts'

/** Matches `CREDENTIAL_FILINGS` in the contract layer, and the circuit's arity. */
const CREDENTIAL_FILINGS = 3

const REVIEW_THRESHOLD = 3n

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Proving is not instant, and a UI that pretends it is will not survive the demo. */
const PROVE_MS = 2100

interface MockCase {
  caseCommitment: string
  title: string
  /** Filings by everyone, including this reporter. Public on chain. */
  reports: bigint
  /** This reporter filed against it. Private to them. */
  hasFiled: boolean
  /**
   * The body's answer, ABSENT until there is one.
   *
   * Optional rather than a nullable record with blank fields, mirroring the
   * ledger: on chain an unanswered case has no entry in `caseResponses` at all,
   * and the whole accountability claim rests on absence being distinguishable
   * from silence-written-down.
   */
  response?: { kind: ResponseKind; grounds: string; detail: string }
}

/**
 * Titles exist only here. On chain a case is a 32-byte commitment and nothing
 * else — no title, no description, no reporter. Anything human-readable comes
 * from off-chain data keyed by the commitment, which is a gap the demo papers
 * over and a real deployment has to answer for.
 */
/**
 * Counts chosen so both halves of the oversight portal have something to show:
 * two cases past the threshold with different backlogs behind them, and two
 * still short of it. A registry where only one case had escalated would render
 * the "acercándose al umbral" section against a single row and the escalation
 * ordering against nothing at all.
 */
const INITIAL: MockCase[] = [
  { caseCommitment: 'a3f1'.repeat(16), title: 'Vertido en el canal norte', reports: 11n, hasFiled: false },
  { caseCommitment: 'd8e5'.repeat(16), title: 'Descarga nocturna de residuos', reports: 4n, hasFiled: false },
  { caseCommitment: 'b7c2'.repeat(16), title: 'Obra sin permiso en zona protegida', reports: 2n, hasFiled: false },
  { caseCommitment: 'c419'.repeat(16), title: 'Tala fuera de temporada', reports: 0n, hasFiled: false },
]

/**
 * One mutable chain, shared by every service — which is what a chain is.
 *
 * Screens used to carry their own copies of this data, so a filing on one
 * screen was invisible on the next. Anything a screen shows now comes from
 * here, and every mutation re-emits to everyone watching.
 */
// Both feeds are served from this one object because they are two projections
// of one state, and a filing has to move both. It implements `ReporterFeed`
// directly and exposes the oversight pair under different names, adapted below:
// the two interfaces share method names and mean different things by them.
class MockChain implements ReporterFeed {
  private cases = INITIAL.map((c) => ({ ...c }))
  private watchers = new Set<(v: ReporterView) => void>()
  private latest: ReporterView | null = null
  private oversightWatchers = new Set<(v: PublicLedgerView) => void>()
  private latestOversight: PublicLedgerView | null = null

  constructor() {
    this.latest = this.snapshot()
    this.latestOversight = this.oversightSnapshot()
  }

  private snapshot(): ReporterView {
    const cases: CaseView[] = this.cases.map((c) => ({
      caseCommitment: c.caseCommitment,
      reports: c.reports,
      underReview: c.reports >= REVIEW_THRESHOLD,
      hasFiled: c.hasFiled,
      canFile: !c.hasFiled,
    }))
    const myFilingCount = this.cases.filter((c) => c.hasFiled).length
    return {
      cases,
      myFilingCount,
      canPresentCredential: myFilingCount >= CREDENTIAL_FILINGS,
      reviewThreshold: REVIEW_THRESHOLD,
      admittedCount: BigInt(this.cases.length),
    }
  }

  /**
   * The same projection `deriveOversightView` performs on real ledger state:
   * split at the contract's escalation flag, most corroborated first, and the
   * "after escalation" count clamped so a case at exactly the threshold does
   * not read as already overdue.
   *
   * Reimplemented rather than shared because the real one takes an
   * `AmparoLedger` and this mock has no ledger. That is a drift risk, and the
   * mitigation is the same as everywhere else in this file: the rules are
   * copied from the circuit, not invented, so a mock that disagrees is a bug
   * here rather than a surprise on stage.
   */
  private oversightSnapshot(): PublicLedgerView {
    const projected: PublicCaseView[] = this.cases.map((c) => {
      const underReview = c.reports >= REVIEW_THRESHOLD
      return {
        caseCommitment: c.caseCommitment,
        reports: c.reports,
        underReview,
        reportsAfterEscalation:
          underReview && c.reports > REVIEW_THRESHOLD ? c.reports - REVIEW_THRESHOLD : 0n,
        reportsToReview: underReview ? 0n : REVIEW_THRESHOLD - c.reports,
        answered: c.response !== undefined,
        // Spread, so an unanswered case has no `grounds` key rather than an
        // empty one - the same shape `derivePublicView` produces, because a
        // mock that flattened it would hide the distinction the screens read.
        ...(c.response
          ? { kind: c.response.kind, grounds: c.response.grounds, detail: c.response.detail }
          : {}),
      }
    })
    const byReports = (a: PublicCaseView, b: PublicCaseView): number =>
      a.reports === b.reports ? 0 : a.reports > b.reports ? -1 : 1

    return {
      underReview: projected.filter((c) => c.underReview).sort(byReports),
      approaching: projected.filter((c) => !c.underReview).sort(byReports),
      cases: projected,
      unanswered: projected.filter((c) => c.underReview && !c.answered),
      admittedCount: BigInt(this.cases.length),
      underReviewCount: projected.filter((c) => c.underReview).length,
      totalReports: projected.reduce((n, c) => n + c.reports, 0n),
      reviewThreshold: REVIEW_THRESHOLD,
    }
  }

  private emit(): void {
    this.latest = this.snapshot()
    for (const watcher of this.watchers) watcher(this.latest)
    this.latestOversight = this.oversightSnapshot()
    for (const watcher of this.oversightWatchers) watcher(this.latestOversight)
  }

  current(): ReporterView | null {
    return this.latest
  }

  currentOversight(): PublicLedgerView | null {
    return this.latestOversight
  }

  async *oversight$(): AsyncIterable<PublicLedgerView> {
    const queue: PublicLedgerView[] = this.latestOversight ? [this.latestOversight] : []
    let wake: (() => void) | null = null
    const watcher = (v: PublicLedgerView) => {
      queue.push(v)
      wake?.()
    }
    this.oversightWatchers.add(watcher)
    try {
      for (;;) {
        while (queue.length) yield queue.shift() as PublicLedgerView
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = null
      }
    } finally {
      this.oversightWatchers.delete(watcher)
    }
  }

  /** One admitted case, or undefined. Mutable: the services write through it. */
  caseFor(caseCommitment: string): MockCase | undefined {
    return this.cases.find((c) => c.caseCommitment === caseCommitment)
  }

  /**
   * Writes the body's answer and re-emits BOTH views.
   *
   * Re-emitting is the point: a response changes public state, so every screen
   * watching has to see it without asking. A mock that stored it privately
   * would make the backlog look unanswered until a reload.
   */
  recordResponse(caseCommitment: string, response: NonNullable<MockCase['response']>): void {
    const target = this.caseFor(caseCommitment)
    if (!target) throw new Error('Case is not in the admitted registry')
    target.response = response
    this.emit()
  }

  async *view$(): AsyncIterable<ReporterView> {
    const queue: ReporterView[] = this.latest ? [this.latest] : []
    let wake: (() => void) | null = null
    const watcher = (v: ReporterView) => {
      queue.push(v)
      wake?.()
    }
    this.watchers.add(watcher)
    try {
      for (;;) {
        while (queue.length) yield queue.shift() as ReporterView
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = null
      }
    } finally {
      this.watchers.delete(watcher)
    }
  }

  /** Title for a commitment. Off-chain data, as noted above. */
  titleOf(caseCommitment: string): string {
    return this.cases.find((c) => c.caseCommitment === caseCommitment)?.title ?? 'Caso'
  }

  async file(caseCommitment: string): Promise<TxResult> {
    const target = this.cases.find((c) => c.caseCommitment === caseCommitment)
    if (!target) throw new Error('Case is not in the admitted registry')
    // The circuit's `spentFilingNullifiers` check, in the mock. Refusing here
    // is what keeps `myFilingCount` honest: a mock that allowed it would unlock
    // the credential with one filing repeated three times, which the real
    // circuit rejects on distinctness.
    if (target.hasFiled) throw new Error('Subject already filed for this case')

    await wait(PROVE_MS)
    target.hasFiled = true
    target.reports += 1n
    this.emit()
    return { txId: `mock-filing-${caseCommitment.slice(0, 8)}` }
  }

  async present(context: string): Promise<TxResult> {
    if ((this.latest?.myFilingCount ?? 0) < CREDENTIAL_FILINGS) {
      throw new Error('Fewer than three filings on record; no passing proof exists')
    }
    await wait(PROVE_MS)
    return { txId: `mock-credential-${context}` }
  }
}

export const chain = new MockChain()

export const reporterFeed: ReporterFeed = chain

export const oversightFeed: OversightFeed = {
  view$: () => chain.oversight$(),
  current: () => chain.currentOversight(),
}

/**
 * The control body's answer, with the circuit's refusals.
 *
 * Three rules, copied from `respondToCase` rather than invented, and each one
 * is load-bearing for the demo being honest:
 *
 *   - only on an escalated case. Otherwise the body could dismiss on one filing
 *     and the public record would read as a diligent answer to something nobody
 *     watched escalate.
 *   - written once. The expensive property is not that it investigates: it is
 *     that DISMISSING is on the record too, forever, with reasoning attached.
 *   - grounds required, and within the fixed-width budget. The optional detail
 *     field has no such limit, which is exactly why the mandatory one is the
 *     narrow one — an unbounded field cannot be constrained in a circuit at all.
 */
class MockResponses implements ResponseService {
  async respond(
    caseCommitment: string,
    kind: ResponseKind,
    grounds: string,
    detail = '',
  ): Promise<TxResult> {
    const target = chain.caseFor(caseCommitment)
    if (!target) throw new Error('Este caso no está en el registro de casos admitidos.')
    if (target.reports < REVIEW_THRESHOLD) {
      throw new Error(
        'El caso todavía no alcanzó el umbral. El organismo sólo responde casos escalados.',
      )
    }
    if (target.response) {
      throw new Error('Este caso ya tiene respuesta registrada, y no se puede editar.')
    }

    const trimmed = grounds.trim()
    if (!trimmed) throw new Error('La fundamentación es obligatoria.')

    const size = groundsByteLength(trimmed)
    if (size > GROUNDS_BYTES) {
      // Refuses instead of truncating, exactly like `encodeGrounds`, which is
      // what would reject this on chain.
      throw new Error(
        `La fundamentación ocupa ${size} bytes y el máximo es ${GROUNDS_BYTES}. ` +
          'Se rechaza en vez de recortarse: la entrada es permanente y no se puede reescribir.',
      )
    }

    await wait(PROVE_MS)
    chain.recordResponse(caseCommitment, { kind, grounds: trimmed, detail })
    return { txId: `mock-response-${caseCommitment.slice(0, 8)}` }
  }
}

export const responseService: ResponseService = new MockResponses()

export const reportingService: ReportingService = {
  file: (caseCommitment) => chain.file(caseCommitment),
}

export const credentialService: CredentialService = {
  present: (context) => chain.present(context),
}

/**
 * No chain involvement, by construction: `proven` is `false` and the screens
 * that use it say so. See `DEMO_ONLY_DISCLOSURE` in `contracts.ts`.
 */
export const disclosureService: DisclosureService = {
  async authorize(_caseCommitment: string, _selection: DisclosureSelection): Promise<DisclosureReceipt> {
    await wait(900)
    return { proven: false, recipient: 'Autoridad Ambiental' }
  },
}

export const identityService: IdentityService = {
  async unlock() {
    await wait(1500)
    return { subject: 'demo', voiceProven: false }
  },
}

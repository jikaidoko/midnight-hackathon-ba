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
//   - a diverged registry disables every filing at once (admittedRoot frozen)
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
  ReporterFeed,
  ReporterView,
  ReportingService,
  IdentityService,
  TxResult,
} from './contracts'

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
}

/**
 * Titles exist only here. On chain a case is a 32-byte commitment and nothing
 * else — no title, no description, no reporter. Anything human-readable comes
 * from off-chain data keyed by the commitment, which is a gap the demo papers
 * over and a real deployment has to answer for.
 */
const INITIAL: MockCase[] = [
  { caseCommitment: 'a3f1'.repeat(16), title: 'Vertido en el canal norte', reports: 2n, hasFiled: false },
  { caseCommitment: 'b7c2'.repeat(16), title: 'Obra sin permiso en zona protegida', reports: 1n, hasFiled: false },
  { caseCommitment: 'c419'.repeat(16), title: 'Tala fuera de temporada', reports: 0n, hasFiled: false },
  { caseCommitment: 'd8e5'.repeat(16), title: 'Descarga nocturna de residuos', reports: 4n, hasFiled: false },
]

/**
 * One mutable chain, shared by every service — which is what a chain is.
 *
 * Screens used to carry their own copies of this data, so a filing on one
 * screen was invisible on the next. Anything a screen shows now comes from
 * here, and every mutation re-emits to everyone watching.
 */
class MockChain implements ReporterFeed {
  private cases = INITIAL.map((c) => ({ ...c }))
  private diverged = false
  private watchers = new Set<(v: ReporterView) => void>()
  private latest: ReporterView | null = null

  constructor() {
    this.latest = this.snapshot()
  }

  private snapshot(): ReporterView {
    const cases: CaseView[] = this.cases.map((c) => ({
      caseCommitment: c.caseCommitment,
      reports: c.reports,
      underReview: c.reports >= REVIEW_THRESHOLD,
      hasFiled: c.hasFiled,
      canFile: !c.hasFiled && !this.diverged,
    }))
    const myFilingCount = this.cases.filter((c) => c.hasFiled).length
    return {
      cases,
      myFilingCount,
      canPresentCredential: myFilingCount >= CREDENTIAL_FILINGS,
      reviewThreshold: REVIEW_THRESHOLD,
      admittedRootFrozen: 1n,
      admittedRootLive: this.diverged ? 2n : 1n,
      registryDiverged: this.diverged,
    }
  }

  private emit(): void {
    this.latest = this.snapshot()
    for (const watcher of this.watchers) watcher(this.latest)
  }

  current(): ReporterView | null {
    return this.latest
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
    if (this.diverged) throw new Error('Case is not in the admitted registry')
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

  /** Demo control: shows the state where nothing is fileable. Not a user action. */
  setDiverged(value: boolean): void {
    this.diverged = value
    this.emit()
  }
}

export const chain = new MockChain()

export const reporterFeed: ReporterFeed = chain

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

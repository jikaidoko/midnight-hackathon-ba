// adapters.ts — the chain-backed implementations of the service contracts.
//
// These are the mirror image of the scripts, and they do the same one
// pre-flight check for the same reason: a proof costs real seconds, and a
// failure that only the circuit catches arrives as one opaque assert after the
// user has waited.
//
//   is the case in the admitted registry?
//
// There used to be a second check here — does the live admitted root still
// equal the root frozen into the filing registry at deployment — because the
// two contracts could drift out from under each other. There is one contract
// now, `registerFiling` asserts against the live registry directly, and
// nothing here can go stale the way a frozen root could.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts'
import { map, type Observable } from 'rxjs'
import {
  deriveReporterView,
  reporterView$,
  publicView$,
} from '@amparo/contracts/derived-state'

import { ledger, filingNullifier } from '@amparo/contracts/ledger'
import { amparoContract } from './contract'
import type { CaseView, PublicLedgerView, ReporterView } from '@amparo/contracts/derived-state'

import type {
  CaseResponseView,
  CredentialService,
  OversightFeed,
  ReporterFeed,
  ReportingService,
  ResponseService,
  TxResult,
} from '../services/contracts'
import type { AmparoConfig } from './config'
import { PRIVATE_STATE_ID, type AmparoProviders } from './providers'
import { filingsElsewhere, filingsFor, fromHex, recordFiling, subjectSecret } from './subject-store'
import { createSubjectState } from '@amparo/generated/amparo-witnesses.js'

export type { CaseView }

/** The circuit takes 32 bytes; a verifier has a readable name. */
async function contextBytes(name: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))
  return new Uint8Array(digest)
}

/**
 * Bridges an rxjs stream to the async iterable the screens consume.
 *
 * The error branch is the part worth keeping in one place: without it a failed
 * subscription leaves the loop parked on a promise nobody will ever resolve, so
 * a dead indexer renders as a spinner that never resolves instead of an error
 * anybody can read.
 */
async function* drain<T>(stream: Observable<T>): AsyncIterable<T> {
  const queue: T[] = []
  let wake: (() => void) | null = null
  let failure: unknown = null
  const subscription = stream.subscribe({
    next: (v) => { queue.push(v); wake?.() },
    error: (e) => { failure = e; wake?.() },
  })
  try {
    for (;;) {
      while (queue.length) yield queue.shift() as T
      if (failure) throw failure
      await new Promise<void>((resolve) => { wake = resolve })
      wake = null
    }
  } finally {
    subscription.unsubscribe()
  }
}

export class ChainReporterFeed implements ReporterFeed {
  private latest: ReporterView | null = null

  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  current(): ReporterView | null {
    return this.latest
  }

  view$(): AsyncIterable<ReporterView> {
    return drain(
      reporterView$(this.providers as never, {
        contractAddress: this.config.contractAddress,
        secret: subjectSecret(),
        reviewThreshold: this.config.reviewThreshold,
      }).pipe(map((view) => {
        this.latest = view
        return view
      })),
    )
  }
}

/**
 * The control body's backlog, read straight off the chain.
 *
 * Note what this constructor does NOT take and never should: a secret. The
 * oversight view is derivable by any observer, which is the property that makes
 * "nobody told us" unavailable as a defence. A credential requirement here
 * would quietly delete that.
 */
export class ChainOversightFeed implements OversightFeed {
  private latest: PublicLedgerView | null = null

  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  current(): PublicLedgerView | null {
    return this.latest
  }

  view$(): AsyncIterable<PublicLedgerView> {
    return drain(
      publicView$(this.providers as never, {
        contractAddress: this.config.contractAddress,
        reviewThreshold: this.config.reviewThreshold,
      }).pipe(map((view) => {
        this.latest = view
        return view
      })),
    )
  }
}

/**
 * Writing a response needs a circuit this build does not carry.
 *
 * It reports that instead of throwing at the call site, and the difference
 * matters: the screen reads `available` and renders the reason next to a
 * disabled control, so the gap is visible BEFORE someone writes a full
 * justification into a form that was never going to submit it.
 *
 * When the circuit lands, this class is replaced by one that calls
 * `respondToCase` — and nothing above it changes, because the screens already
 * treat "cannot write" as a state rather than an exception.
 */
export class UnavailableResponses implements ResponseService {
  readonly available = false
  readonly unavailableReason =
    'Este build no incluye el circuito de respuesta, así que en modo cadena no se puede ' +
    'registrar ninguna. El flujo completo corre en modo demostración.'

  private static readonly EMPTY: ReadonlyMap<string, CaseResponseView> = new Map()

  responses(): ReadonlyMap<string, CaseResponseView> {
    return UnavailableResponses.EMPTY
  }

  subscribe(): () => void {
    return () => {}
  }

  async respond(): Promise<TxResult> {
    throw new Error(this.unavailableReason)
  }
}

async function deployedAmparo(providers: AmparoProviders, config: AmparoConfig) {
  return findDeployedContract(providers as never, {
    contractAddress: config.contractAddress,
    compiledContract: amparoContract() as never,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createSubjectState(subjectSecret()),
  } as never)
}

export class ChainReportingService implements ReportingService {
  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  async file(caseCommitment: string): Promise<TxResult> {
    const commitment = fromHex(caseCommitment, 'case commitment')

    const raw = await this.providers.publicDataProvider.queryContractState(
      this.config.contractAddress,
    )
    if (!raw) throw new Error('Contract has no state on chain')
    const state = ledger(raw.data as never)

    // One pre-flight, and only because a proof costs real time: the circuit
    // asserts the same thing, but it would do so after the proof was built.
    if (!state.admittedIndex.member(commitment)) {
      throw new Error('This case is not in the admitted registry')
    }

    const contract = await deployedAmparo(this.providers, this.config)
    const called = await (contract as unknown as {
      callTx: { registerFiling(c: Uint8Array): Promise<{ public: { txId: string } }> }
    }).callTx.registerFiling(commitment)

    recordFiling(this.config.contractAddress, commitment)
    return { txId: called.public.txId }
  }
}

export class ChainCredentialService implements CredentialService {
  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  async present(context: string): Promise<TxResult> {
    const registry = this.config.contractAddress
    const recorded = filingsFor(registry)

    if (recorded.length < 3) {
      // Before blaming the reporter: filings against a PREVIOUS deployment are
      // the usual cause. They are real and still on chain; they just cannot
      // back a credential here.
      const stranded = filingsElsewhere(registry)
      const note = stranded.length
        ? ` Hay ${stranded.reduce((n, e) => n + e.count, 0)} denuncia(s) registradas contra ` +
          'otro contrato: siguen en la cadena, pero no pueden respaldar una credencial acá.'
        : ''
      throw new Error(
        `Tenés ${recorded.length} denuncia(s) en este contrato; la credencial necesita 3.${note}`,
      )
    }

    const secret = subjectSecret()
    // Three distinct cases. The circuit asserts distinctness itself, so taking
    // the first three of a de-duplicated record cannot smuggle a repeat past it.
    const cases = recorded.slice(0, 3).map((h) => fromHex(h, 'recorded case'))

    const raw = await this.providers.publicDataProvider.queryContractState(registry)
    if (!raw) throw new Error('Contract has no state on chain')
    const state = ledger(raw.data as never)

    const claimedRoot = state.filingNullifierTree.root()
    const paths = cases.map((kase) => {
      const nullifier = filingNullifier(secret, kase)
      const path = state.filingNullifierTree.findPathForLeaf(nullifier)
      if (!path) {
        throw new Error(
          'Una de las denuncias registradas no aparece en la cadena bajo esta credencial. ' +
            'O la transacción nunca asentó, o esta no es la identidad que la hizo.',
        )
      }
      return path
    })

    const contract = await deployedAmparo(this.providers, this.config)
    const called = await (contract as unknown as {
      callTx: {
        proveRepeatFilings(
          cases: Uint8Array[],
          paths: unknown[],
          claimedRoot: { field: bigint },
          context: Uint8Array,
        ): Promise<{ public: { txId: string } }>
      }
    }).callTx.proveRepeatFilings(cases, paths, claimedRoot, await contextBytes(context))

    return { txId: called.public.txId }
  }
}

/** Re-exported so a caller can derive a view from a state pair it already has. */
export { deriveReporterView }

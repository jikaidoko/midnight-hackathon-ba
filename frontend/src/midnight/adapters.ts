// adapters.ts — the chain-backed implementations of the service contracts.
//
// These are the mirror image of the scripts, and they do the same pre-flight
// checks for the same reason: a proof costs real seconds, and both failures
// otherwise arrive as one opaque circuit assert after the user has waited.
//
//   1. is the case in the admitted registry, and can a path be read for it?
//   2. does the live admitted root still equal the root frozen into the filing
//      registry at deployment?
//
// The second is the two-contract integration gap and the one that reads as a
// bug in the wrong place: the case IS admitted, but its path reaches the live
// root while the circuit compares against the frozen one, so the proof is
// rejected with "Case is not in the admitted registry" — a message that sends
// everyone looking at the case commitment.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts'
import { map, type Observable } from 'rxjs'
import {
  deriveReporterView,
  reporterView$,
} from '@amparo/contracts/derived-state'
import {
  caseLedger,
  filingLedger,
  filingNullifier,
} from '@amparo/contracts/ledger'
import { filingContract } from './contract'
import type { ReporterView } from '@amparo/contracts/view-types'
import type {
  CredentialService,
  ReporterFeed,
  ReportingService,
  TxResult,
} from '../services/contracts'
import type { AmparoConfig } from './config'
import { PRIVATE_STATE_ID, type AmparoProviders } from './providers'
import { filingsElsewhere, filingsFor, fromHex, recordFiling, subjectSecret } from './subject-store'

/** The circuit takes 32 bytes; a verifier has a readable name. */
async function contextBytes(name: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))
  return new Uint8Array(digest)
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

  /**
   * Adapts the contract layer's observable to the async iterable the interface
   * consumes. Both contracts are watched, not just the filing registry: an
   * admission moves the live root and can make every case unfileable at once,
   * and a screen watching only the contract it acts on would stay confidently
   * wrong.
   */
  async *view$(): AsyncIterable<ReporterView> {
    const stream: Observable<ReporterView> = reporterView$(this.providers as never, {
      caseAdmissionAddress: this.config.caseAdmissionAddress,
      filingRegistryAddress: this.config.filingRegistryAddress,
      secret: subjectSecret(),
      reviewThreshold: this.config.reviewThreshold,
    }).pipe(map((view) => {
      this.latest = view
      return view
    }))

    const queue: ReporterView[] = []
    let wake: (() => void) | null = null
    let failure: unknown = null
    const subscription = stream.subscribe({
      next: (v) => { queue.push(v); wake?.() },
      error: (e) => { failure = e; wake?.() },
    })
    try {
      for (;;) {
        while (queue.length) yield queue.shift() as ReporterView
        if (failure) throw failure
        await new Promise<void>((resolve) => { wake = resolve })
        wake = null
      }
    } finally {
      subscription.unsubscribe()
    }
  }
}

async function filingRegistry(providers: AmparoProviders, config: AmparoConfig) {
  return findDeployedContract(providers as never, {
    contractAddress: config.filingRegistryAddress,
    compiledContract: filingContract() as never,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: { subjectSecret: subjectSecret() },
  } as never)
}

export class ChainReportingService implements ReportingService {
  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  async file(caseCommitment: string): Promise<TxResult> {
    const commitment = fromHex(caseCommitment, 'case commitment')

    const rawCases = await this.providers.publicDataProvider.queryContractState(
      this.config.caseAdmissionAddress,
    )
    if (!rawCases) throw new Error('The case registry has no state on chain')
    const caseState = caseLedger(rawCases.data as never)

    // Read from the chain's own tree, never rebuilt from a local mirror: the
    // chain is the only source that cannot have drifted.
    const path = caseState.admittedCases.findPathForLeaf(commitment)
    if (!path) throw new Error('This case is not in the admitted registry')

    const rawFilings = await this.providers.publicDataProvider.queryContractState(
      this.config.filingRegistryAddress,
    )
    if (!rawFilings) throw new Error('The filing registry has no state on chain')
    const filingState = filingLedger(rawFilings.data as never)

    const live = caseState.admittedCases.root().field
    const frozen = filingState.admittedRoot.field
    if (live !== frozen) {
      throw new Error(
        'The case registry moved after the filing registry was deployed, so no case can be ' +
          'filed against right now. The case is admitted; the proof would still be rejected. ' +
          'This needs a redeploy, not a different case.',
      )
    }

    const contract = await filingRegistry(this.providers, this.config)
    const called = await (contract as unknown as {
      callTx: { registerFiling(c: Uint8Array, p: unknown): Promise<{ public: { txId: string } }> }
    }).callTx.registerFiling(commitment, path)

    // Recorded against THIS registry. The nullifier backing a credential lives
    // in this contract's tree and nowhere else.
    recordFiling(this.config.filingRegistryAddress, commitment)
    return { txId: called.public.txId }
  }
}

export class ChainCredentialService implements CredentialService {
  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  async present(context: string): Promise<TxResult> {
    const registry = this.config.filingRegistryAddress
    const recorded = filingsFor(registry)

    if (recorded.length < 3) {
      // Before blaming the reporter: filings against a PREVIOUS registry are
      // the usual cause. They are real and still on chain; they just cannot
      // back a credential here.
      const stranded = filingsElsewhere(registry)
      const note = stranded.length
        ? ` Hay ${stranded.reduce((n, e) => n + e.count, 0)} denuncia(s) registradas contra ` +
          'otro registro: siguen en la cadena, pero no pueden respaldar una credencial acá.'
        : ''
      throw new Error(
        `Tenés ${recorded.length} denuncia(s) en este registro; la credencial necesita 3.${note}`,
      )
    }

    const secret = subjectSecret()
    // Three distinct cases. The circuit asserts distinctness itself, so taking
    // the first three of a de-duplicated record cannot smuggle a repeat past it.
    const cases = recorded.slice(0, 3).map((h) => fromHex(h, 'recorded case'))

    const rawFilings = await this.providers.publicDataProvider.queryContractState(registry)
    if (!rawFilings) throw new Error('The filing registry has no state on chain')
    const filingState = filingLedger(rawFilings.data as never)

    const claimedRoot = filingState.filingNullifierTree.root()
    const paths = cases.map((kase) => {
      const nullifier = filingNullifier(secret, kase)
      const path = filingState.filingNullifierTree.findPathForLeaf(nullifier)
      if (!path) {
        throw new Error(
          'Una de las denuncias registradas no aparece en la cadena bajo esta credencial. ' +
            'O la transacción nunca asentó, o esta no es la identidad que la hizo.',
        )
      }
      return path
    })

    const contract = await filingRegistry(this.providers, this.config)
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

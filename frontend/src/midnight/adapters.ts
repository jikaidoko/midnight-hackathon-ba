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
} from '@amparo/contracts/derived-state'
import { ledger, filingNullifier } from '@amparo/contracts/ledger'
import { amparoContract } from './contract'
import type { CaseView, ReporterView } from '@amparo/contracts/derived-state'
import type {
  CredentialService,
  ReporterFeed,
  ReportingService,
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

export class ChainReporterFeed implements ReporterFeed {
  private latest: ReporterView | null = null

  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  current(): ReporterView | null {
    return this.latest
  }

  async *view$(): AsyncIterable<ReporterView> {
    const stream: Observable<ReporterView> = reporterView$(this.providers as never, {
      contractAddress: this.config.contractAddress,
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

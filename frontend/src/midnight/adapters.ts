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

import { ledger, filingNullifier, encodeGrounds } from '@amparo/contracts/ledger'
import { amparoContract } from './contract'
import type { CaseView, PublicLedgerView, ReporterView } from '@amparo/contracts/derived-state'

import type {
  CredentialService,
  OversightFeed,
  ReporterFeed,
  ReportingService,
  ResponseService,
  TxResult,
} from '../services/contracts'
import type { ResponseKind } from '@amparo/contracts/ledger'
import type { AmparoConfig } from './config'
import {
  AUTHORITY_PRIVATE_STATE_ID,
  PRIVATE_STATE_ID,
  type AmparoProviders,
} from './providers'
import { withWallet } from './wallet'
import { authorityOf } from './authority'
import { filingsElsewhere, filingsFor, fromHex, recordFiling, subjectSecret } from './subject-store'
import { createAuthorityState, createSubjectState } from '@amparo/generated/amparo-witnesses.js'

export type { CaseView }

/** The circuit takes 32 bytes; a verifier has a readable name. */
async function contextBytes(name: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))
  return new Uint8Array(digest)
}

/**
 * Bridges an rxjs stream to the async iterable the screens consume.
 *
 * Termination is the part worth keeping in one place: a source that ends leaves
 * the loop parked on a promise nobody will ever resolve, so the `finally` never
 * runs, the subscription is never unsubscribed, and the screen shows a spinner
 * indistinguishable from a slow network.
 *
 * BOTH endings are handled, and `complete` is not the theoretical one: the
 * indexer subscription ends by COMPLETING, not by erroring, about ten seconds
 * after a connection drops. `keepAlive` currently resubscribes on both, which
 * hides the gap — and hides it in a way that makes the error branch unreachable
 * through the same pipe. A `take(1)`, a bounded `retry({ count })`, or any
 * caller that passes a stream without `keepAlive` reaches these.
 */
async function* drain<T>(stream: Observable<T>): AsyncIterable<T> {
  const queue: T[] = []
  let wake: (() => void) | null = null
  let failure: unknown = null
  let ended = false
  const subscription = stream.subscribe({
    next: (v) => { queue.push(v); wake?.() },
    error: (e) => { failure = e; wake?.() },
    complete: () => { ended = true; wake?.() },
  })
  try {
    for (;;) {
      while (queue.length) yield queue.shift() as T
      if (failure) throw failure
      if (ended) return
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
 * Records the control body's answer on chain.
 *
 * Two pre-flights, and both exist because a proof costs real seconds while the
 * circuit's rejection arrives as one opaque assert after the wait:
 *
 *   - the case is escalated. Answering one that never escalated would put a
 *     diligent-looking reply on the public record for something nobody watched
 *     escalate.
 *   - it has no answer yet. The entry is write-once and permanent.
 *
 * `encodeGrounds` is imported rather than reimplemented, and it THROWS on
 * overflow instead of truncating. That is the behaviour worth importing: cutting
 * UTF-8 at a byte offset splits whatever character straddles it, and this is the
 * last place that can still refuse.
 */
export class ChainResponseService implements ResponseService {
  constructor(
    private readonly providers: AmparoProviders,
    private readonly config: AmparoConfig,
  ) {}

  async respond(
    caseCommitment: string,
    kind: ResponseKind,
    grounds: string,
    detail = '',
  ): Promise<TxResult> {
    const commitment = fromHex(caseCommitment, 'case commitment')

    const raw = await this.providers.publicDataProvider.queryContractState(
      this.config.contractAddress,
    )
    if (!raw) throw new Error('Contract has no state on chain')
    const state = ledger(raw.data as never)

    if (!state.casesUnderReview.member(commitment)) {
      throw new Error(
        'El caso todavía no alcanzó el umbral. El organismo sólo responde casos escalados.',
      )
    }
    if (state.caseResponses.member(commitment)) {
      throw new Error('Este caso ya tiene respuesta registrada, y no se puede editar.')
    }

    const contract = await deployedAmparo(this.providers, this.config, 'authority')
    const called = await (contract as unknown as {
      callTx: {
        respondToCase(
          caseCommitment: Uint8Array,
          kind: ResponseKind,
          grounds: Uint8Array,
          detail: string,
        ): Promise<{ public: { txId: string } }>
      }
    }).callTx.respondToCase(commitment, kind, encodeGrounds(grounds), detail)

    return { txId: called.public.txId }
  }
}

/**
 * Which credential a circuit will ask for.
 *
 * The contract is one contract but not one role: `registerFiling` and
 * `proveRepeatFilings` ask for the reporter's secret, `respondToCase` asks for
 * the control body's. Naming it at the call site is what keeps that visible —
 * the alternative is a single default that is silently right for two of the
 * three flows.
 */
type CallerRole = 'reporter' | 'authority'

/**
 * The contract handle, with a wallet attached and the caller's own credential.
 *
 * The wallet is built here and not at startup, so the cost of a sync is paid by
 * the first write rather than by every reader. Reads never come through this
 * function — which is the same separation the oversight view depends on, one
 * layer down: deriving the backlog requires no key, and nothing here can quietly
 * make it require one.
 *
 * The role decides the private state, and it used to be hard-coded to the
 * reporter's. That made answering a case impossible from this build in a way no
 * screen could reveal: the portal rendered, the button worked, and the witness
 * would refuse a secret it was never given.
 */
async function deployedAmparo(
  providers: AmparoProviders,
  config: AmparoConfig,
  role: CallerRole,
) {
  // The credential is read FIRST, before the wallet is built. Both can refuse,
  // but only one of them is cheap: `authoritySecret` refuses deterministically
  // and by name, while `withWallet` pays a full build and up to 90s of sync. In
  // the other order a reporter's build sits through the whole sync and only then
  // reads "this build has no authority secret" — the pre-flight discipline the
  // rest of this file argues for, applied to this function.
  const identity =
    role === 'authority'
      ? {
          privateStateId: AUTHORITY_PRIVATE_STATE_ID,
          initialPrivateState: createAuthorityState(authoritySecret(config)),
        }
      : {
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: createSubjectState(subjectSecret()),
        }

  // `initialPrivateState` is consulted ONLY when the key is absent, so on its own
  // it cannot express "this credential, now". That was harmless while the secret
  // was compiled in and therefore never changed; once the portal can be handed a
  // different one — the entire point of presenting it — the asymmetry becomes a
  // silent substitution. A second official at the same browser would have their
  // secret accepted by the form, ignored by the provider, and refused by the
  // circuit tens of seconds later, naming a digest mismatch rather than the cause.
  //
  // Writing it makes the presented credential authoritative. `identity` still
  // carries it so the two agree rather than one depending on the other.
  if (role === 'authority') {
    providers.privateStateProvider.setContractAddress(config.contractAddress)
    await providers.privateStateProvider.set(
      AUTHORITY_PRIVATE_STATE_ID,
      identity.initialPrivateState,
    )
  }

  const signing = await withWallet(providers, config)

  return findDeployedContract(signing as never, {
    contractAddress: config.contractAddress,
    compiledContract: amparoContract() as never,
    ...identity,
  } as never)
}

/**
 * Forgets the control body's stored credential.
 *
 * The held bytes are only half of leaving the portal: the witness reads from the
 * private-state store, so a credential that stays there is one the next person at
 * this browser can answer with. Scoped to the authority's key alone — the
 * reporter's state lives under its own `privateStateId` and has nothing to do
 * with whoever just signed out.
 */
export async function forgetAuthorityState(
  providers: AmparoProviders,
  config: AmparoConfig,
): Promise<void> {
  providers.privateStateProvider.setContractAddress(config.contractAddress)
  await providers.privateStateProvider.remove(AUTHORITY_PRIVATE_STATE_ID)
}

/**
 * The control body's credential, or a refusal that says which build this is.
 *
 * Absence is not a misconfiguration to be papered over: a build without it is a
 * reporter's build, which is the common and correct case. What it must not do is
 * hand the circuit a placeholder — zeroes would prove a false statement about a
 * digest that cannot match, spending the proving time first and failing on an
 * assert that names the contract rather than the build.
 */
function authoritySecret(config: AmparoConfig): Uint8Array {
  const secret = authorityOf(config)
  if (!secret) {
    throw new Error(
      'No hay credencial de autoridad presentada, así que no se puede registrar una ' +
        'respuesta. Registrarla prueba conocimiento de la preimagen del compromiso de ' +
        'autoridad publicado por el contrato. Leer el registro público no necesita ninguna ' +
        'credencial, y eso es lo que esta pantalla sí puede hacer sin identificarse.',
    )
  }
  return secret
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

    const contract = await deployedAmparo(this.providers, this.config, 'reporter')
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

    const contract = await deployedAmparo(this.providers, this.config, 'reporter')
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

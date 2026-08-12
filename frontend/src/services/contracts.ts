// contracts.ts â€” what the interface is allowed to ask for.
//
// These interfaces are shaped by what the chain can answer, not by what the
// screens would like to show. That direction matters: the first version of this
// file described `sealReport`, `getReports` and a per-field `authorize`, none of
// which map onto a circuit. `getReports` in particular cannot exist â€” public
// state is commitments and nullifiers, and "which reports are mine" is a
// question only the holder of the secret can answer, on their own device.
//
// So the view type comes from the contract layer rather than being restated
// here. `ReporterView` is that join â€” public ledger state combined with the
// reporter's secret â€” and importing it means the two sides cannot drift apart
// silently: a field renamed in the circuit's view breaks the typecheck here
// rather than showing a stale value on a screen.
//
// The mapping to circuits, so it stays honest:
//
//   ReporterFeed.view$        (read only, no proof)
//   ReportingService.file     -> registerFiling(caseCommitment)
//   CredentialService.present -> proveRepeatFilings(cases, paths, root, context)
//   DisclosureService         -> NOTHING. See below.

import type {
  CaseView,
  PublicCaseView,
  PublicLedgerView,
  ReporterView,
} from '@amparo/contracts/derived-state'
import { GROUNDS_BYTES, ResponseKind } from '@amparo/contracts/ledger'

export type { CaseView, ReporterView, PublicCaseView, PublicLedgerView }

/**
 * The live view every screen reads from.
 *
 * An observable rather than a fetch because both contracts move underneath the
 * user: someone else filing changes a corroboration count, and an admission can
 * make every case unfileable at once. A screen that read once would keep
 * offering a button that no longer works.
 */
export interface ReporterFeed {
  view$(): AsyncIterable<ReporterView>
  /** Current value, for the first paint before the stream has emitted. */
  current(): ReporterView | null
}

/** Outcome of a transaction that produced a proof. */
export interface TxResult {
  readonly txId: string
}

export interface ReportingService {
  /**
   * Files against an admitted case. The narrative itself never reaches this
   * call: what goes on chain is a nullifier derived from the reporter's secret
   * and the case commitment. Everything the user typed or recorded stays local.
   *
   * Throws if the case is not fileable â€” check `CaseView.canFile` before
   * offering the button, because failing here costs a proof.
   */
  file(caseCommitment: string): Promise<TxResult>
}

export interface CredentialService {
  /**
   * Proves three distinct filings by the same person, revealing neither which
   * ones nor who. `context` binds the proof to one verifier so it cannot be
   * replayed against another.
   *
   * Requires `ReporterView.canPresentCredential`. There is no partial result:
   * below the bar, no passing transaction can be built at all.
   */
  present(context: string): Promise<TxResult>
}

/**
 * Turns a SPOKEN PHRASE into the reporter's secret - the value every one of
 * their nullifiers derives from, and the only thing that links their filings to
 * each other.
 *
 * NOT voice biometrics, and the difference is not a detail. Nothing measures a
 * voice: the phrase is recognised as text and only the WORDS survive, so anyone
 * who says the same phrase gets the same credential. Biometrics would need a
 * fuzzy extractor - a reading varies between takes, so a secret hashed from one
 * changes every time and can never rebuild a nullifier. `PASSPHRASE_NOTICE` is
 * on screen because a demo that let this read as "your voice is your key" would
 * be claiming the part that does not exist.
 *
 * What it buys, and it is the property a device-minted secret cannot have: the
 * phrase is not stored anywhere, so the identity survives a cleared browser and
 * moves between devices. The audio, when a microphone is used at all, never
 * leaves the machine - see `spoken-phrase.ts`, which refuses the microphone
 * outright rather than let a cloud recogniser see the phrase.
 */
export interface IdentityService {
  /**
   * Takes the phrase as text, from speech or typing, and derives the secret.
   *
   * Rejects if the phrase is below the floor, or if it does not match a
   * credential already on this device that has filings under it - replacing that
   * one would strand them permanently.
   */
  unlock(phrase: string): Promise<IdentityResult>
}

/**
 * What unlocking actually did to the credential on this device.
 *
 * Three values rather than a boolean, because "there was already a credential
 * here" and "the phrase reproduced it" are different facts and only the second is
 * a recovery. A stored random secret with no filings under it gets REPLACED, so a
 * boolean would report that as confirmation of a phrase nothing confirmed.
 *
 * And the honest limit: on a device that never held a credential, no phrase can
 * be confirmed, so a typo and the real phrase both land on `created`. The screen
 * says that rather than implying a check happened.
 */
export type AdoptionOutcome = 'created' | 'confirmed' | 'replaced'

export interface IdentityResult {
  readonly outcome: AdoptionOutcome
  /** Words the phrase reduced to, so a thin phrase is visible rather than implied. */
  readonly words: number
}

/**
 * Rendered wherever the phrase is captured.
 *
 * Says the two things someone would otherwise assume wrongly: that this is not
 * recognising them, and that the phrase is the whole secret. The second is the
 * part with a real cost - nullifiers are public, so guessing the phrase is an
 * offline attack that links the filings together.
 */
export const PASSPHRASE_NOTICE =
  'No es reconocimiento de voz: vale la frase, no quien la dice. Elegila larga y que no ' +
  'la diga nadie mas, porque es todo tu secreto y no queda guardada en ningun lado.'

/**
 * DEMO ONLY â€” this has no circuit behind it, and no on-chain meaning.
 *
 * Per-field selective disclosure is a real Midnight capability and it is what
 * the share screens describe, but nothing in this repository implements it. The
 * screens that call this are labelled in the interface itself so the claim is
 * never made silently; see `DEMO_ONLY_DISCLOSURE`.
 *
 * Kept as an interface rather than deleted because the shape is the design
 * intent, and a named gap is easier to close than an absence.
 */
export interface DisclosureService {
  authorize(caseCommitment: string, selection: DisclosureSelection): Promise<DisclosureReceipt>
}

export interface DisclosureSelection {
  content: boolean
  evidence: boolean
  location: boolean
  identity: boolean
}

export interface DisclosureReceipt {
  /** Always false. There is no proof; this is a mock of a flow, not the flow. */
  readonly proven: false
  readonly recipient: string
}

/**
 * Rendered by the share screens. The demo shows a capability the contracts do
 * not have yet, and saying so on screen is the difference between a prototype
 * and a false claim â€” especially in front of an audience that cannot read the
 * circuits.
 */
export const DEMO_ONLY_DISCLOSURE =
  'Demo: selective disclosure is not proven on chain in this build.'

/* ============================================================
   OVERSIGHT — the control body's side
   ============================================================

   The asymmetry this closes: escalation is public and permanent, so a reporter
   is on record the moment they file. The body's answer used to be a button in a
   private dashboard, which meant the only party the system held to account was
   the one with the least power. Both sides are now on the same ledger.

   The reason the feed below takes no secret is the whole property. A backlog
   readable only by the body would make "we were never told" unfalsifiable.
   Anyone can derive it, so nobody can claim that. */

/**
 * The live backlog, from public state alone.
 *
 * Deliberately a separate feed from `ReporterFeed` rather than a field on it:
 * they are read by different people, and the reporter's view needs a secret
 * this one must never acquire. Sharing a type would make the day someone adds a
 * private field to the shared shape completely silent.
 */
export interface OversightFeed {
  view$(): AsyncIterable<PublicLedgerView>
  current(): PublicLedgerView | null
}

/**
 * What the body decided. The contract's own enum, not a copy.
 *
 * Re-exported rather than restated as a string union: a union would have to be
 * mapped to the enum at the call site, and a mapping is a second statement of
 * the same three values that nothing compares.
 */
export { ResponseKind }

/**
 * The grounds budget, from the contract layer rather than repeated here.
 *
 * BYTES, not characters — Spanish with accents runs out around 230 of these, so
 * a character counter would let someone write past the limit and only find out
 * at submission with the whole justification typed.
 *
 * `encodeGrounds` is the authority and it REFUSES rather than truncates: cutting
 * UTF-8 at a byte offset splits whatever character straddles it, and the entry
 * can never be rewritten, so refusing is the last chance anyone gets. This
 * counter exists so the form can say so WHILE they type; it does not decide.
 */
export { GROUNDS_BYTES }

export function groundsByteLength(text: string): number {
  return new TextEncoder().encode(text.trim()).length
}

/**
 * Recording the body's answer. WRITES ONLY.
 *
 * There is deliberately no read side here. Responses are public ledger state,
 * so they arrive through `OversightFeed` on `PublicCaseView.answered` and its
 * companions, and a second source for the same fact is a second source that can
 * disagree — which is how a screen ends up showing "sin respuesta registrada"
 * over a case that was answered on chain an hour ago.
 *
 * Absence is the observable, and the view preserves it properly: an unanswered
 * case has no `grounds` key at all rather than an empty one. Blank and absent
 * render identically and mean opposite things.
 */
export interface ResponseService {
  respond(
    caseCommitment: string,
    kind: ResponseKind,
    grounds: string,
    detail?: string,
  ): Promise<TxResult>
}

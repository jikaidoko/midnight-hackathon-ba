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

import type { CaseView, ReporterView } from '@amparo/contracts/derived-state'
import type { PublicCaseView, PublicLedgerView } from '@amparo/contracts/derived-state'

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
 * Unlocks the reporter's secret â€” the value every one of their nullifiers
 * derives from, and the only thing that links their filings to each other.
 *
 * The voice match itself is DEMO ONLY: nothing in this build records or
 * compares audio. What is real is the shape â€” the biometric stays off-chain and
 * unlocks a local secret, and only the secret ever reaches a circuit. Audio
 * must never become public state, so this boundary is the design, not a detour.
 */
export interface IdentityService {
  unlock(): Promise<IdentityResult>
}

export interface IdentityResult {
  /** Label of the reporter this session acts as. Never leaves the device. */
  readonly subject: string
  /** DEMO ONLY: no audio was captured or compared. */
  readonly voiceProven: false
}

export const DEMO_ONLY_VOICE =
  'Demo: voice is simulated; no audio is captured in this build.'

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

/** What the body decided. Matches the circuit's `ResponseKind` ordering. */
export type ResponseKind = 'investigation' | 'referral' | 'dismissal'

export interface CaseResponseView {
  readonly kind: ResponseKind
  /** Public reasoning, permanent and unrewritable. */
  readonly grounds: string
  readonly txId: string
}

/**
 * Grounds are a fixed-width field on chain, and this is the pre-flight for it.
 *
 * BYTES, not characters: Spanish with accents runs around 230 in this budget,
 * so a character counter would let someone write past the limit and only find
 * out at submission. Counted here so the form can say so while they type.
 *
 * The on-chain encoder is the authority and it REFUSES rather than truncates —
 * cutting UTF-8 at a byte offset splits whatever character straddles it, and
 * this entry can never be rewritten, so refusing is the last chance anyone gets.
 */
export const GROUNDS_MAX_BYTES = 256

export function groundsByteLength(text: string): number {
  return new TextEncoder().encode(text.trim()).length
}

export interface ResponseService {
  /**
   * Whether this build can write a response at all.
   *
   * Rendered, not swallowed. A form that submits into a service which cannot
   * write is the same lie as a nav entry that goes nowhere, and it costs
   * whoever is testing the time to discover it by typing a full justification.
   */
  readonly available: boolean
  /** Why not, in words a screen can show. Null when `available`. */
  readonly unavailableReason: string | null

  /**
   * Responses on record, keyed by case commitment.
   *
   * ABSENCE is the observable, so this is a map with missing keys rather than
   * entries with empty fields: blank and absent render identically and mean the
   * opposite things. An escalated case that is not in here is public evidence
   * that the body was told and said nothing.
   */
  responses(): ReadonlyMap<string, CaseResponseView>
  /** Notifies on any change to the map above. Returns the unsubscribe. */
  subscribe(onChange: () => void): () => void

  respond(caseCommitment: string, kind: ResponseKind, grounds: string): Promise<TxResult>
}

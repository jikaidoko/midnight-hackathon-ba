// subject-store.ts — the reporter's credential, in the browser.
//
// This is the one piece of state that cannot be rebuilt from anywhere. The
// secret is what every one of this reporter's nullifiers derives from, and
// nothing on chain links a filing to a person — that is the privacy property,
// working. Lose the secret and the filings stay on chain but stop being
// provably yours, permanently.
//
// The list of filed cases is kept for the same structural reason, not for
// convenience: `proveRepeatFilings` needs the three case commitments to rebuild
// its nullifiers, and the chain deliberately cannot tell anyone which cases a
// given reporter filed against. If the client forgets, the credential is
// unreachable even though the filings are right there.
//
// Filings are keyed by REGISTRY ADDRESS. A redeployed filing registry starts an
// empty nullifier tree, so filings made against the previous one stay on chain
// and can never back a credential in the new one. Keying by address is what
// lets the interface say that, instead of reporting three filings and then
// failing to find a Merkle path for any of them.
//
// localStorage is a demo-grade store: any script on the origin can read it, and
// clearing site data destroys the credential with no recovery. A real
// deployment puts this in a wallet.

const KEY = 'amparo.subject.v1'

export interface SubjectRecord {
  /** 32-byte hex. */
  secret: string
  /** Case commitments filed against, per filing-registry address. */
  filings: Record<string, string[]>
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export function fromHex(hex: string, name: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be 64 hex characters (32 bytes), got "${hex}"`)
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function read(): SubjectRecord | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SubjectRecord
    // A malformed record must not be silently replaced: minting a fresh secret
    // over a corrupt one destroys the only copy of something irreplaceable, and
    // the reporter would see filings vanish with no error to explain it.
    if (typeof parsed.secret !== 'string' || typeof parsed.filings !== 'object') {
      throw new Error('shape')
    }
    return parsed
  } catch {
    throw new Error(
      'The stored reporter credential is unreadable. It is the only thing that can prove ' +
        'your filings, so it will not be overwritten automatically. Clearing site data for ' +
        'this origin starts a new identity and abandons any filings already on chain.',
    )
  }
}

function write(record: SubjectRecord): void {
  localStorage.setItem(KEY, JSON.stringify(record))
}

/**
 * The reporter's secret, created on first use and stable afterwards.
 *
 * Created with the platform CSPRNG rather than derived from anything the page
 * knows. A secret derived from a public value is a secret anyone can recompute,
 * and every filing this reporter ever makes hangs off it.
 */
export function subjectSecret(): Uint8Array {
  const existing = read()
  if (existing) return fromHex(existing.secret, 'stored secret')

  const secret = crypto.getRandomValues(new Uint8Array(32))
  write({ secret: toHex(secret), filings: {} })
  return secret
}

/** Cases filed against one registry, as recorded locally. */
export function filingsFor(registry: string): string[] {
  return read()?.filings[registry] ?? []
}

export function recordFiling(registry: string, caseCommitment: Uint8Array): void {
  const record = read()
  if (!record) throw new Error('No reporter credential on file; nothing to record against')
  const list = record.filings[registry] ?? []
  const hex = toHex(caseCommitment)
  // Deduplicated because the circuit asserts the three cases are distinct: a
  // repeat stored twice would let the interface count to three and then build a
  // proof the circuit rejects.
  if (!list.includes(hex)) list.push(hex)
  record.filings[registry] = list
  write(record)
}

/**
 * Filings recorded against OTHER registries.
 *
 * Worth surfacing before telling someone they have too few filings: a redeploy
 * is the usual cause, the filings are real and still on chain, and the honest
 * message is that they cannot back a credential *here* — not that they do not
 * exist.
 */
export function filingsElsewhere(registry: string): { registry: string; count: number }[] {
  const record = read()
  if (!record) return []
  return Object.entries(record.filings)
    .filter(([address, cases]) => address !== registry && cases.length > 0)
    .map(([address, cases]) => ({ registry: address, count: cases.length }))
}

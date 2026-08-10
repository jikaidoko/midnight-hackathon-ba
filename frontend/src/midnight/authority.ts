// authority.ts — the control body's credential, presented rather than compiled.
//
// WHAT THIS CHANGES, said plainly: with the secret baked into the build, holding
// the build WAS being the control body. Anyone handed the bundle — a colleague,
// a CDN, a laptop left open — held the credential that answers cases on a public,
// permanent ledger. This moves the secret to something an official presents when
// they sit down, so distributing the app stops being distributing the authority.
//
// WHAT IT DOES NOT CHANGE, because overstating it would be worse than the gap:
// the secret still has to reach the private-state store for the witness to serve
// it to the circuit, and that store is on the machine. So this is NOT "the secret
// is never at rest" — it is "the secret is not in the artifact you distribute",
// which is the property that was actually broken. `withdraw()` is the other half:
// it removes the stored state as well as the held bytes, so leaving the portal
// leaves nothing behind for the next person at that browser.
//
// It is held in a module variable and NOT in `sessionStorage`. sessionStorage
// survives a reload and is readable by any script on this origin, which would
// trade the property above for the convenience of not retyping. The cost is real
// and it is the intended one: a refresh means presenting the credential again.

import { decodeHex32, isHex32, isWalletSeed, type AmparoConfig } from './config'

/**
 * Where the credential in force came from.
 *
 * `build` is not a synonym for "configured correctly" — it is the dangerous
 * case, and it is named separately so the interface can show it rather than let
 * it pass as ordinary.
 */
export type AuthoritySource = 'session' | 'build' | 'none'

let presented: Uint8Array | null = null

// Plain subscription rather than a store library: one value, one screen, and
// `useSyncExternalStore` wants exactly this shape.
const listeners = new Set<() => void>()

/**
 * Bumped on every change so `getSnapshot` can return a primitive.
 *
 * Returning the `Uint8Array` itself would hand React a new-ish reference whose
 * identity says nothing about whether the credential changed, and returning a
 * freshly built object every call is the documented way to make
 * `useSyncExternalStore` loop forever.
 */
let revision = 0

function announce(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function subscribeAuthority(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function authorityRevision(): number {
  return revision
}

/**
 * Validates and holds the credential for this session.
 *
 * The two TESTS come from configuration so there is one definition of each; the
 * two SENTENCES are written here, in the language of the screen that shows them.
 * Reusing configuration's message helper is what produced "El secreto de
 * autoridad must be exactly 64 hex characters" on a Spanish portal — a refusal
 * half in each language, which typecheck, build and the suite all reported green.
 *
 * Throws with the reason, and the caller shows it verbatim. A paraphrase like
 * "clave inválida" would hide which of the two mistakes was made, and they have
 * completely different fixes: one is a bad paste, the other is the wrong secret
 * entirely.
 */
export function presentAuthority(rawHex: string): void {
  const hex = rawHex.trim()

  if (!isHex32(hex)) {
    throw new Error(
      'El secreto de autoridad son exactamente 64 caracteres hexadecimales, sin prefijo ' +
        `0x y sin espacios. Pegaste ${hex.length}. Si lo copiaste del registro de ` +
        'despliegue, revisá que no haya quedado cortado.',
    )
  }

  if (isWalletSeed(hex)) {
    throw new Error(
      'Ese es el seed de la billetera, no el secreto de autoridad. Son dos credenciales ' +
        'distintas con la misma forma: el seed paga y firma la transacción, el secreto ' +
        'prueba que sos el organismo. Si sigue, se construye una prueba válida de algo ' +
        'falso y recién falla adentro del circuito, medio minuto después.',
    )
  }

  presented = decodeHex32(hex)
  announce()
}

/** Drops the held credential. The stored state is cleared by the caller. */
export function withdrawAuthority(): void {
  presented = null
  announce()
}

/**
 * The credential in force, presented first.
 *
 * A presented secret BEATS a compiled one on purpose. A build that carries a
 * credential is the configuration this file exists to make survivable, so the
 * person actually at the portal has to be able to override it — otherwise the
 * screen would be decorative on exactly the builds that need it most.
 */
export function authorityOf(config: AmparoConfig): Uint8Array | null {
  return presented ?? config.authoritySecret ?? null
}

export function authoritySourceOf(config: AmparoConfig): AuthoritySource {
  if (presented) return 'session'
  if (config.authoritySecret) return 'build'
  return 'none'
}

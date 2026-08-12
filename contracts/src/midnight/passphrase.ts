// passphrase.ts - a spoken phrase, turned into the reporter's secret.
//
// WHAT THIS IS NOT: biometrics. Nothing here measures a voice. Two people
// speaking the same phrase get the same secret, and one person with a cold gets
// the same secret too, because the only input that survives is the WORDS.
//
// That distinction is the whole reason this module exists in this shape. Voice
// biometrics would need a fuzzy extractor: a biometric reading varies between
// takes, so hashing an embedding yields a different value every time, and a
// secret that changes cannot rebuild a nullifier - the credential stops being
// provable. Tolerating that noise while staying unlinkable across enrolments is
// an open construction, not an implementation detail, so it is out of scope and
// nothing here pretends otherwise.
//
// A spoken phrase sidesteps the noise problem entirely: recognised text is
// DISCRETE. Normalisation absorbs the variation a recogniser actually produces -
// casing, punctuation, accents, spacing - and after that the same phrase gives
// the same 32 bytes on any device, with nothing stored anywhere. That is the one
// property the random secret in a browser store cannot offer: clearing site data
// destroys a random secret permanently, and this one is re-derivable from
// something the person carries in their head.
//
// WHAT IT COSTS, stated because a screen has to say it:
//
//   1. The secret is only as strong as the phrase. Nullifiers are public, so
//      anyone who guesses the phrase can recompute them and link the filings
//      together. PBKDF2 raises the cost per guess; it does not create entropy.
//   2. There is no per-person salt, and there cannot be one - a stored salt is
//      the storage this design exists to avoid, so the derivation is fixed and
//      identical phrases collide into one identity. The word floor below makes
//      that improbable rather than impossible.
//   3. The phrase recovers the SECRET, never the filing list. Which cases a
//      reporter filed against is not on chain by design, so a fresh device
//      re-derives the right identity and still cannot build a credential from
//      filings it has no record of.

/**
 * Domain separation. A secret derived here must not be reinterpretable as any
 * other value derived from the same phrase - a future signing key, say - so the
 * label is part of the input rather than a comment about it.
 */
const DERIVATION_DOMAIN = 'amparo:passphrase:subject-secret:v1';

/**
 * PBKDF2 work factor. High because the phrase is the entire secret and the
 * verifier of a guess is public: a nullifier on chain either matches or does
 * not, so guessing is an offline attack with no rate limit anywhere.
 *
 * PBKDF2 rather than Argon2 because WebCrypto has PBKDF2 and does not have
 * Argon2, and the alternatives are both worse here: hand-rolling a memory-hard
 * KDF is exactly the class of thing that must never be hand-rolled, and pulling
 * in a wasm Argon2 adds a fourth wasm package to a bundle whose duplicate-wasm
 * problem is already documented at length in two package manifests.
 */
export const PBKDF2_ITERATIONS = 600_000;

/**
 * The floor a phrase has to clear. Five words rather than a character count
 * alone: "contrasena" is ten characters and one guess.
 *
 * This is a floor, not a recommendation. Five ordinary words of connected
 * Spanish carry far less entropy than 32 random bytes, and the interface says so
 * where the person can read it. Enforcing something is what keeps the failure
 * loud instead of silent.
 */
export const PHRASE_MIN_WORDS = 5;
export const PHRASE_MIN_CHARS = 20;

/**
 * Recognised text -> the canonical form the secret derives from.
 *
 * Every transformation here absorbs a variation a speech recogniser actually
 * produces for the SAME spoken phrase, and each one is load-bearing: a
 * difference that survives normalisation is a secret that fails to reproduce,
 * which the person experiences as "my phrase stopped working".
 *
 * Accents are folded, and that is a deliberate trade. Recognisers are not
 * consistent about diacritics across takes, so keeping them would make the
 * secret depend on whether the engine happened to write the tilde - a phrase
 * that unlocks intermittently is worse than a marginally smaller keyspace.
 *
 * Digits are kept: someone who says a number means it, and dropping it would
 * silently shrink the phrase they chose.
 */
export function normalizePassphrase(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // Split combining marks off their base letters, then drop only the marks.
    // NFD before the strip is what makes this work on precomposed input, which
    // is what a recogniser emits.
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    // Anything that is not a letter, a digit or a space becomes a separator.
    // Punctuation is the single most variable part of recognised text: the same
    // sentence comes back with and without a final stop, and Spanish engines add
    // opening marks that no one spoke.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The words a normalised phrase is made of. Empty for an empty phrase. */
export function phraseWords(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(' ');
}

export interface PhraseProblem {
  readonly code: 'empty' | 'too-few-words' | 'too-short';
  /** Shown to the person. Says what to do, not what a constant is called. */
  readonly message: string;
}

/**
 * Why this phrase cannot be used, or `null` if it can.
 *
 * Returns the problem rather than throwing so a form can say it while someone
 * types. `derivePassphraseSecret` throws on the same conditions, so a caller
 * that skips this check still cannot derive from a phrase below the floor - the
 * check is for the message, not for the guarantee.
 */
export function phraseProblem(normalized: string): PhraseProblem | null {
  const words = phraseWords(normalized);
  if (words.length === 0) {
    return { code: 'empty', message: 'No se reconocio ninguna palabra.' };
  }
  if (words.length < PHRASE_MIN_WORDS) {
    return {
      code: 'too-few-words',
      message: `La frase necesita al menos ${PHRASE_MIN_WORDS} palabras; se reconocieron ${words.length}.`,
    };
  }
  if (normalized.length < PHRASE_MIN_CHARS) {
    return {
      code: 'too-short',
      message: `La frase es demasiado corta: ${normalized.length} caracteres de ${PHRASE_MIN_CHARS}.`,
    };
  }
  return null;
}

/**
 * Spoken phrase -> the reporter's 32-byte secret.
 *
 * Deterministic: the same phrase gives the same bytes on every device, forever,
 * with nothing persisted. That is the point.
 *
 * Takes RAW text and normalises internally. A version taking pre-normalised
 * input would let a caller derive from a phrase that skipped normalisation, and
 * the resulting secret would be subtly unreproducible - right on the device that
 * made it, wrong everywhere else.
 */
export async function derivePassphraseSecret(text: string): Promise<Uint8Array> {
  const normalized = normalizePassphrase(text);
  const problem = phraseProblem(normalized);
  // Refused here as well as in the form. This function is what any future caller
  // reaches for, and a floor enforced only by the interface is not a floor.
  if (problem) throw new Error(`Frase inutilizable: ${problem.message}`);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalized),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(DERIVATION_DOMAIN),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

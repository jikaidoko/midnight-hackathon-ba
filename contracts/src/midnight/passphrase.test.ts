// passphrase.test.ts - the two halves of the same guarantee.
//
// Normalisation has to absorb enough variation that one phrase always derives
// the same secret, and NOT so much that two different phrases collapse into one
// identity. Only testing the first half would pass with `normalize = () => ''`,
// which reproduces perfectly and gives every reporter on earth the same secret.
// Both directions are here for that reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PBKDF2_ITERATIONS,
  PHRASE_MIN_CHARS,
  PHRASE_MIN_WORDS,
  derivePassphraseSecret,
  normalizePassphrase,
  phraseProblem,
  phraseWords,
} from './passphrase.js';

/** Long enough to clear the floor, so a case can be about one thing at a time. */
const PHRASE = 'el arroyo del fondo bajo espuma blanca en abril';

test('the same phrase derives the same secret', async () => {
  const first = await derivePassphraseSecret(PHRASE);
  const second = await derivePassphraseSecret(PHRASE);
  assert.deepEqual(first, second);
  assert.equal(first.length, 32);
});

test('recogniser variation of one phrase derives one secret', async () => {
  // Each of these is what a speech recogniser hands back for the SAME spoken
  // sentence across takes: sentence casing, a final stop, opening punctuation
  // Spanish engines add, dropped accents, and padded or doubled spacing.
  const takes = [
    'El arroyo del fondo bajo espuma blanca en abril.',
    '  el   arroyo del fondo bajo espuma blanca en abril  ',
    'El arroyo del fondo bajo espuma blanca en abril',
    'el arroyo del fondo bajo espuma blanca en abril!',
  ];
  const canonical = normalizePassphrase(PHRASE);
  for (const take of takes) {
    assert.equal(normalizePassphrase(take), canonical, `take not normalised to canonical: "${take}"`);
  }

  const expected = await derivePassphraseSecret(PHRASE);
  for (const take of takes) {
    assert.deepEqual(await derivePassphraseSecret(take), expected, `take derived a different secret: "${take}"`);
  }
});

test('accents are folded, so a recogniser writing them or not lands on one secret', async () => {
  // The trade this makes: accented and unaccented spellings are ONE phrase.
  // Deliberate - engines are inconsistent about diacritics between takes, and a
  // phrase that unlocks only when the tilde happens to be written is worse than
  // a slightly smaller keyspace.
  const accented = 'la comision jamas respondio por el rio del norte';
  const withMarks = 'la comisión jamás respondió por el río del norte';
  assert.equal(normalizePassphrase(withMarks), normalizePassphrase(accented));
  assert.deepEqual(await derivePassphraseSecret(withMarks), await derivePassphraseSecret(accented));
});

test('different phrases derive different secrets', async () => {
  // The half that fails if normalisation strips too much. A one-word change, a
  // reordering, and an added word all have to survive: word order carries
  // meaning, so a bag-of-words normalisation would merge phrases that a person
  // chose to keep apart.
  const others = [
    'el arroyo del fondo bajo espuma negra en abril',
    'en abril el arroyo del fondo bajo espuma blanca',
    'el arroyo del fondo bajo espuma blanca en abril otra vez',
  ];
  const base = await derivePassphraseSecret(PHRASE);
  for (const other of others) {
    assert.notEqual(normalizePassphrase(other), normalizePassphrase(PHRASE));
    assert.notDeepEqual(await derivePassphraseSecret(other), base, `collided with the base phrase: "${other}"`);
  }
});

test('digits survive normalisation', () => {
  // Someone who says a number chose it. Dropping it would quietly shorten the
  // phrase they picked, and they would never know the secret is weaker than the
  // phrase they spoke.
  assert.equal(normalizePassphrase('planta 4 del canal 7 cerro en 2019'), 'planta 4 del canal 7 cerro en 2019');
});

test('normalisation is idempotent', () => {
  const once = normalizePassphrase('  El Arroyo,, del Fondo!!  ');
  assert.equal(normalizePassphrase(once), once);
});

test('phrases below the floor are refused, with a reason', () => {
  assert.equal(phraseProblem(normalizePassphrase(PHRASE)), null);

  assert.equal(phraseProblem(normalizePassphrase('   ...   '))?.code, 'empty');
  assert.equal(phraseProblem(normalizePassphrase('abri la puerta'))?.code, 'too-few-words');

  // Word count and length are separate floors, and this is why: five very short
  // words clear the word check and are still trivially guessable. Reached only
  // when the word floor passes.
  const fiveTinyWords = normalizePassphrase('a mi no me da');
  assert.equal(phraseWords(fiveTinyWords).length, PHRASE_MIN_WORDS);
  assert.ok(fiveTinyWords.length < PHRASE_MIN_CHARS);
  assert.equal(phraseProblem(fiveTinyWords)?.code, 'too-short');
});

test('derivation refuses a phrase below the floor even when the form did not ask', async () => {
  // `phraseProblem` exists for the message; the floor itself lives here. A
  // caller that skips the check must not get a weak secret anyway, because a
  // floor enforced only by the interface is not a floor.
  await assert.rejects(() => derivePassphraseSecret('abri la puerta'), /inutilizable/i);
  await assert.rejects(() => derivePassphraseSecret('   '), /inutilizable/i);
});

test('the work factor stays high enough to be worth calling a KDF', () => {
  // The phrase is the entire secret and a nullifier on chain verifies a guess
  // offline, with no rate limit anywhere. Pinning the floor means dropping the
  // iterations to iterate faster in a demo turns a test red instead of quietly
  // shipping a bare hash.
  assert.ok(
    PBKDF2_ITERATIONS >= 200_000,
    `PBKDF2 iterations dropped to ${PBKDF2_ITERATIONS}; guessing the phrase is an offline attack.`,
  );
});

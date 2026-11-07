import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_BALINESE } from '../src/lib/project.ts';
import { EXCEPTIONS } from '../src/server/aksara/exceptions.ts';
import { isPhoneticNotation, isValidNotation, normalizeNotation, readPhonemes, readSegments, syllabify } from '../src/server/aksara/notation.ts';
import { checkRoundTrip, reverseBalinese } from '../src/server/aksara/reverse.ts';
import { transliterateName, transliterateToken } from '../src/server/aksara/transliterate.ts';
import { ENGINE_VERSION, RULES_VERSION, SOURCE_REFS } from '../src/server/aksara/version.ts';

// Expected values are written by hand as escapes, independent of the engine's tables and of any font.
const CONSONANTS = {
  h: '\u1B33', n: '\u1B26', c: '\u1B18', r: '\u1B2D', k: '\u1B13', d: '\u1B24', t: '\u1B22', s: '\u1B32', w: '\u1B2F',
  l: '\u1B2E', m: '\u1B2B', g: '\u1B15', b: '\u1B29', ng: '\u1B17', p: '\u1B27', j: '\u1B1A', y: '\u1B2C', ny: '\u1B1C',
};
const VOWELS = { a: '', ā: '\u1B35', i: '\u1B36', ī: '\u1B37', u: '\u1B38', ū: '\u1B39', é: '\u1B3E', ai: '\u1B3F', o: '\u1B40', au: '\u1B41', e: '\u1B42' };

const PROMPT_VECTORS = [
  ['basa', '\u1B29\u1B32'],
  ['désa', '\u1B24\u1B3E\u1B32'],
  ['candi', '\u1B18\u1B26\u1B44\u1B24\u1B36'],
  ['sari', '\u1B32\u1B2D\u1B36'],
  ['sāri', '\u1B32\u1B35\u1B2D\u1B36'],
  ['bali', '\u1B29\u1B2E\u1B36'],
  ['warung', '\u1B2F\u1B2D\u1B38\u1B02'],
  ['ida', '\u1B33\u1B36\u1B24'],
  ['aksara', '\u1B05\u1B13\u1B44\u1B31\u1B2D'],
];
const FINALS = [
  ['barang', '\u1B29\u1B2D\u1B02'],
  ['sabar', '\u1B32\u1B29\u1B03'],
  ['sawah', '\u1B32\u1B2F\u1B04'],
  ['anak', '\u1B33\u1B26\u1B13\u1B44'],
  ['surat', '\u1B32\u1B38\u1B2D\u1B22\u1B44'],
  ['nyurat', '\u1B1C\u1B38\u1B2D\u1B22\u1B44'],
];
const CLUSTERS = [
  ['candra', '\u1B18\u1B26\u1B44\u1B24\u1B44\u1B2D'],
  ['santi', '\u1B32\u1B26\u1B44\u1B22\u1B36'],
  ['sastra', '\u1B32\u1B32\u1B44\u1B22\u1B44\u1B2D'],
  ['prabu', '\u1B27\u1B44\u1B2D\u1B29\u1B38'],
  ['bank', '\u1B29\u1B26\u1B44\u1B13\u1B44'],
];
const SYLLABLE_CLOSERS = [
  ['karma', '\u1B13\u1B03\u1B2B'],
  ['bangli', '\u1B29\u1B02\u1B2E\u1B36'],
  ['rahmat', '\u1B2D\u1B04\u1B2B\u1B22\u1B44'],
  ['bangkrut', '\u1B29\u1B02\u1B13\u1B44\u1B2D\u1B38\u1B22\u1B44'],
  ['park', '\u1B27\u1B03\u1B13\u1B44'],
];
const DIGRAPHS = [
  ['nyoman', '\u1B1C\u1B40\u1B2B\u1B26\u1B44'],
  ['ngurah', '\u1B17\u1B38\u1B2D\u1B04'],
  ['bangun', '\u1B29\u1B17\u1B38\u1B26\u1B44'],
  ['nglawang', '\u1B17\u1B44\u1B2E\u1B2F\u1B02'],
  ['sony', '\u1B32\u1B40\u1B26\u1B44\u1B2C\u1B44'],
];
const WORD_INITIAL_VOWELS = [
  ['alas', '\u1B33\u1B2E\u1B32\u1B44'],
  ['ubud', '\u1B33\u1B38\u1B29\u1B38\u1B24\u1B44'],
  ['emas', '\u1B33\u1B42\u1B2B\u1B32\u1B44'],
  ['éka', '\u1B33\u1B3E\u1B13'],
  ['ogoh', '\u1B33\u1B40\u1B15\u1B40\u1B04'],
];
const PEPET_ON_RA_LA = [
  ['jelema', '\u1B1A\u1B42\u1B0D\u1B2B'],
  ['rena', '\u1B0B\u1B26'],
  ['reng', '\u1B0B\u1B02'],
  ['ler', '\u1B0D\u1B03'],
  ['kreta', '\u1B13\u1B3A\u1B22'],
  ['klebit', '\u1B13\u1B3C\u1B29\u1B36\u1B22\u1B44'],
];
const VOWEL_SEQUENCES = [
  ['santai', '\u1B32\u1B26\u1B44\u1B22\u1B3F'],
  ['pulau', '\u1B27\u1B38\u1B2E\u1B41'],
  ['bahu', '\u1B29\u1B33\u1B38'],
  ['dua', '\u1B24\u1B38\u1B33'],
  ['saat', '\u1B32\u1B33\u1B22\u1B44'],
];
const NUMBERS = [
  ['108', '\u1B51\u1B50\u1B58'],
  ['0123456789', '\u1B50\u1B51\u1B52\u1B53\u1B54\u1B55\u1B56\u1B57\u1B58\u1B59'],
  ['bali2', '\u1B29\u1B2E\u1B36\u1B52'],
  ['7ubud', '\u1B57\u1B33\u1B38\u1B29\u1B38\u1B24\u1B44'],
];
const FAITHFUL_VECTORS = [...PROMPT_VECTORS, ...FINALS, ...CLUSTERS, ...SYLLABLE_CLOSERS, ...DIGRAPHS, ...WORD_INITIAL_VOWELS, ...PEPET_ON_RA_LA, ...VOWEL_SEQUENCES, ...NUMBERS];

function hex(text) { return [...text].map((char) => char.codePointAt(0).toString(16).toUpperCase()).join(' '); }

function assertVectors(vectors) {
  for (const [notation, expected] of vectors) {
    const result = transliterateToken(notation);
    assert.equal(hex(result.balinese), hex(expected), notation);
    assert.equal(result.supported, true, notation);
  }
}

function roundTrip(notation) {
  return checkRoundTrip([notation], transliterateToken(notation).balinese);
}

test('master prompt vectors from §6.5', () => assertVectors(PROMPT_VECTORS));
test('word-final ng, r, h, k, t', () => assertVectors(FINALS));
test('gantungan from consonant clusters', () => assertVectors(CLUSTERS));
test('ng, r, h close a syllable before another consonant', () => assertVectors(SYLLABLE_CLOSERS));
test('digraphs ng and ny', () => assertVectors(DIGRAPHS));
test('word-initial vowels default to ha', () => assertVectors(WORD_INITIAL_VOWELS));
test('pepet on ra and la uses ra repa and la lenga', () => assertVectors(PEPET_ON_RA_LA));
test('diphthongs and vowels in hiatus', () => assertVectors(VOWEL_SEQUENCES));
test('numbers map to Balinese digits', () => assertVectors(NUMBERS));

test('every consonant with every vowel', () => {
  for (const [consonant, base] of Object.entries(CONSONANTS)) {
    for (const [vowel, sign] of Object.entries(VOWELS)) {
      const notation = consonant + vowel;
      const pepetLetter = vowel === 'e' ? { r: '\u1B0B', l: '\u1B0D' }[consonant] : undefined;
      assert.equal(hex(transliterateToken(notation).balinese), hex(pepetLetter ?? base + sign), notation);
    }
  }
});

test('no input produces ra or la with a pepet', () => {
  const samples = [...Object.keys(CONSONANTS).flatMap((c) => [`${c}e`, `k${c}e`, `a${c}e`, `${c}er`]), 'lemah', 'kresna', 'pelem', 'rerama'];
  for (const notation of samples) assert.doesNotMatch(transliterateToken(notation).balinese, /[\u1B2D\u1B2E]\u1B42/u, notation);
});

test('exception table is whole-word and matches the frontend sample', () => {
  assert.equal(`${EXCEPTIONS.get('aksara')} ${transliterateToken('bali').balinese}`, SAMPLE_BALINESE);
  assert.equal(hex(transliterateToken('aksarane').balinese), hex('\u1B33\u1B13\u1B44\u1B32\u1B2D\u1B26\u1B42'));
  for (const [notation, balinese] of EXCEPTIONS) {
    assert.ok(isValidNotation(notation));
    assert.equal(balinese, balinese.normalize('NFC'));
  }
});

test('foreign letters with a defined plain mapping stay supported', () => {
  assertVectors([
    ['khas', '\u1B13\u1B32\u1B44'],
    ['syukur', '\u1B32\u1B38\u1B13\u1B38\u1B03'],
    ['qori', '\u1B13\u1B40\u1B2D\u1B36'],
    ['xena', '\u1B13\u1B44\u1B32\u1B42\u1B26'],
  ]);
});

test('f, v, z keep rerekan in the result but are flagged as unconfirmed', () => {
  const vectors = [
    ['café', '\u1B18\u1B27\u1B34\u1B3E', 'f'],
    ['vila', '\u1B2F\u1B34\u1B36\u1B2E', 'v'],
    ['zaman', '\u1B1A\u1B34\u1B2B\u1B26\u1B44', 'z'],
    ['golf', '\u1B15\u1B40\u1B2E\u1B44\u1B27\u1B34\u1B44', 'f'],
  ];
  for (const [notation, expected, letter] of vectors) {
    const result = transliterateToken(notation);
    assert.equal(hex(result.balinese), hex(expected), notation);
    assert.equal(result.supported, false, notation);
    assert.deepEqual(result.issues, [{ kind: 'unconfirmed', text: letter }], notation);
  }
});

test('symbols leave the aksara and mark the token unsupported', () => {
  const vectors = [
    ['&', ''],
    ["d'bali", '\u1B24\u1B44\u1B29\u1B2E\u1B36'],
    ['warung-sari', '\u1B2F\u1B2D\u1B38\u1B02\u1B32\u1B2D\u1B36'],
    ['sari.', '\u1B32\u1B2D\u1B36'],
  ];
  for (const [notation, expected] of vectors) {
    const result = transliterateToken(notation);
    assert.equal(hex(result.balinese), hex(expected), notation);
    assert.equal(result.supported, false, notation);
    assert.equal(result.issues[0].kind, 'symbol', notation);
  }
});

test('characters outside the notation are unsupported, and the rest is still written', () => {
  const result = transliterateToken('müller');
  assert.equal(result.supported, false);
  assert.deepEqual(result.issues, [{ kind: 'unknown', text: 'ü' }]);
  assert.ok(result.balinese.length > 0);
});

test('a name joins tokens with one space and skips tokens with no aksara', () => {
  const name = transliterateName(['warung', '&', 'sari']);
  assert.equal(hex(name.balineseUnicode), hex('\u1B2F\u1B2D\u1B38\u1B02 \u1B32\u1B2D\u1B36'));
  assert.deepEqual(name.tokens.map((token) => token.supported), [true, false, true]);
  assert.equal(transliterateName(['&']).balineseUnicode, '');
});

test('a custom pronunciation with spaces is written as separate words', () => {
  assert.equal(hex(transliterateToken('wa  ung').balinese), hex('\u1B2F \u1B33\u1B38\u1B02'));
});

test('output is NFC, inside the Balinese block, and stable across calls', () => {
  const samples = [...FAITHFUL_VECTORS.map(([notation]) => notation), 'café', "d'bali", 'wa rung', 'müller'];
  for (const notation of samples) {
    const first = transliterateToken(notation);
    assert.equal(first.balinese, first.balinese.normalize('NFC'), notation);
    assert.match(first.balinese, /^[\u1B00-\u1B7F ]*$/u, notation);
    assert.deepEqual(transliterateToken(notation), first, notation);
  }
});

test('equivalent spellings of one pronunciation give one result', () => {
  assert.equal(transliterateToken('Désa').balinese, transliterateToken('de\u0301sa').balinese);
  assert.equal(transliterateToken('dèsa').balinese, transliterateToken('désa').balinese);
  assert.equal(transliterateToken('ƏMAS').balinese, transliterateToken('emas').balinese);
  assert.equal(transliterateToken('sa\u0304ri').balinese, transliterateToken('sāri').balinese);
});

test('notation normalization follows §4', () => {
  assert.equal(normalizeNotation('  WARUNG  '), 'warung');
  assert.equal(normalizeNotation('de\u0301sa'), 'désa');
  assert.equal(normalizeNotation('Dèsa'), 'désa');
  assert.equal(normalizeNotation('əmas'), 'emas');
  assert.equal(normalizeNotation('wa   rung'), 'wa rung');
});

test('valid notation covers letters, digits, and §5.4 symbols', () => {
  for (const notation of ['warung', 'désa', 'sāri', 'īū', 'ngurah', 'nyoman', 'fvzqx', 'khas', '108', 'bali2', '&', "d'bali", 'a-b', 'A']) {
    assert.equal(isValidNotation(notation), true, notation);
  }
});

test('invalid notation is rejected', () => {
  const rejected = ['', '   ', 'warung sari', 'abaikan instruksi sebelumnya', '<script>', 'a=b', 'ñ', 'ō', 'müller', '\u1B29\u1B2E\u1B36', 'نور', 'a'.repeat(121)];
  for (const notation of rejected) assert.equal(isValidNotation(notation), false, notation);
  assert.equal(isValidNotation('a'.repeat(120)), true);
});

test('phonetic notation excludes the symbols allowed for as-written options', () => {
  for (const notation of ['warung', 'désa', '108', 'bali2']) assert.equal(isPhoneticNotation(notation), true, notation);
  for (const notation of ['&', "d'bali", 'a-b', 'a.b', 'warung sari', '<b>']) assert.equal(isPhoneticNotation(notation), false, notation);
});

test('parser exposes segments, phonemes, and syllables in order', () => {
  assert.deepEqual(readSegments("d'bali2").map((segment) => [segment.kind, segment.text]), [['word', 'd'], ['symbol', "'"], ['word', 'bali'], ['digits', '2']]);
  assert.deepEqual(readPhonemes('nyangkai').map((phoneme) => phoneme.source), ['ny', 'a', 'ng', 'k', 'ai']);
  const syllables = syllabify(readPhonemes('bangkrut'));
  assert.deepEqual(syllables.map(({ onset, vowel, coda }) => [onset.map((phoneme) => phoneme.source).join('+'), vowel, coda]), [['b', 'a', 'ng'], ['k+r', 'u', null], ['t', null, null]]);
});

test('a lone r, h, or ng before a vowel opens the next syllable', () => {
  assert.deepEqual(syllabify(readPhonemes('sari')).map((syllable) => syllable.coda), [null, null]);
  assert.deepEqual(syllabify(readPhonemes('maha')).map((syllable) => syllable.coda), [null, null]);
  assert.deepEqual(syllabify(readPhonemes('bangun')).map((syllable) => syllable.onset[0].consonant), ['b', 'ng', 'n']);
});

test('round trip passes for every faithful vector', () => {
  for (const [notation] of FAITHFUL_VECTORS) {
    const check = roundTrip(notation);
    assert.equal(check.status, 'pass', `${notation} -> ${check.returnedLatin}`);
    assert.equal(check.originalLatin, notation);
    assert.equal(check.returnedLatin, notation);
  }
});

test('round trip passes for every consonant with every vowel', () => {
  for (const consonant of Object.keys(CONSONANTS)) {
    for (const vowel of Object.keys(VOWELS)) {
      const check = roundTrip(consonant + vowel);
      assert.equal(check.status, 'pass', `${consonant}${vowel} -> ${check.returnedLatin}`);
    }
  }
});

test('round trip reports the exact note when the reading is unique', () => {
  assert.deepEqual(roundTrip('warung'), { status: 'pass', note: 'Hasil balik sama dengan pelafalan pilihan (pemeriksaan teknis, bukan pemeriksaan bahasa).', originalLatin: 'warung', returnedLatin: 'warung' });
});

test('round trip names the ha ambiguity for an initial h', () => {
  const check = roundTrip('hari');
  assert.equal(reverseBalinese(transliterateToken('hari').balinese), 'ari');
  assert.equal(check.status, 'pass');
  assert.equal(check.returnedLatin, 'hari');
  assert.match(check.note, /dengan atau tanpa h/);
  assert.doesNotMatch(roundTrip('ari').note, /dengan atau tanpa h/);
});

test('round trip names the ha ambiguity for a vowel carried inside a word', () => {
  const check = roundTrip('dua');
  assert.equal(reverseBalinese(transliterateToken('dua').balinese), 'duha');
  assert.equal(check.status, 'pass');
  assert.match(check.note, /dengan atau tanpa h/);
});

test('a diphthong and a spelled-out h stay distinct readings', () => {
  assert.equal(checkRoundTrip(['bau'], transliterateToken('bahu').balinese).status, 'mismatch');
  assert.equal(checkRoundTrip(['bahu'], transliterateToken('bau').balinese).status, 'mismatch');
});

test('round trip covers rerekan letters', () => {
  for (const notation of ['café', 'vila', 'zaman', 'golf']) assert.equal(roundTrip(notation).status, 'pass', notation);
});

test('round trip reports mismatch when a mapping loses information', () => {
  for (const [notation, returned] of [['xena', 'ksena'], ['qori', 'kori'], ['khas', 'kas'], ['syukur', 'sukur'], ["d'bali", 'dbali']]) {
    const check = roundTrip(notation);
    assert.equal(check.status, 'mismatch', notation);
    assert.equal(check.returnedLatin, returned, notation);
    assert.equal(check.originalLatin, notation, notation);
    assert.ok(check.note.length > 0);
  }
});

test('round trip compares whole names joined by a space', () => {
  const pronunciations = ['Warung', 'sāri', '108'];
  const check = checkRoundTrip(pronunciations, transliterateName(pronunciations).balineseUnicode);
  assert.deepEqual([check.status, check.originalLatin, check.returnedLatin], ['pass', 'warung sāri 108', 'warung sāri 108']);
  const withSymbol = ['warung', '&', 'sari'];
  assert.equal(checkRoundTrip(withSymbol, transliterateName(withSymbol).balineseUnicode).status, 'mismatch');
});

test('round trip reports error, not a crash, on text the reader does not know', () => {
  for (const text of ['\u1B14', 'abc', '\u1B44', '\u1B13\u1B34']) {
    const check = checkRoundTrip(['ka'], text);
    assert.equal(check.status, 'error', hex(text));
    assert.equal(check.originalLatin, 'ka');
    assert.equal(check.returnedLatin, '');
  }
});

test('reverse accepts the decomposed form of taling tedung', () => {
  assert.equal(reverseBalinese('\u1B13\u1B3E\u1B35'), 'ko');
});

test('versions and source references are declared', () => {
  assert.match(ENGINE_VERSION, /\d+\.\d+\.\d+/);
  assert.match(RULES_VERSION, /word-space/);
  assert.ok(SOURCE_REFS.some((ref) => ref.includes('U+1B00')));
  assert.ok(SOURCE_REFS.some((ref) => ref.includes('rerekan')));
  assert.ok(SOURCE_REFS.filter((ref) => ref.startsWith('Belum diakses')).length >= 3, 'unread documents must stay labeled as unread');
});

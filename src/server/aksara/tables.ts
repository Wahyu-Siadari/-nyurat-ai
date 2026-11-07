import "server-only";

// Every code point below was checked by name and decomposition against the Unicode Character
// Database (block Balinese, U+1B00–U+1B7F).

export const ADEG_ADEG = "\u1B44"; // BALINESE ADEG ADEG, canonical combining class 9
export const REREKAN = "\u1B34"; // BALINESE SIGN REREKAN, class 7: stays before adeg adeg under NFC

// Aksara wianjana.
export const CONSONANTS = {
  h: "\u1B33", // ᬳ ha
  n: "\u1B26", // ᬦ na
  c: "\u1B18", // ᬘ ca
  r: "\u1B2D", // ᬭ ra
  k: "\u1B13", // ᬓ ka
  d: "\u1B24", // ᬤ da
  t: "\u1B22", // ᬢ ta
  s: "\u1B32", // ᬲ sa
  w: "\u1B2F", // ᬯ wa
  l: "\u1B2E", // ᬮ la
  m: "\u1B2B", // ᬫ ma
  g: "\u1B15", // ᬕ ga
  b: "\u1B29", // ᬩ ba
  ng: "\u1B17", // ᬗ nga
  p: "\u1B27", // ᬧ pa
  j: "\u1B1A", // ᬚ ja
  y: "\u1B2C", // ᬬ ya
  ny: "\u1B1C", // ᬜ nya
} as const;
export type Consonant = keyof typeof CONSONANTS;

// Pangangge suara, written after the consonant in logical order. The font places taling on the left.
export const VOWEL_SIGNS = {
  a: "", // inherent vowel
  ā: "\u1B35", // ᬵ tedung
  i: "\u1B36", // ᬶ ulu
  ī: "\u1B37", // ᬷ ulu sari
  u: "\u1B38", // ᬸ suku
  ū: "\u1B39", // ᬹ suku ilut
  é: "\u1B3E", // ᬾ taling
  ai: "\u1B3F", // ᬿ taling repa
  o: "\u1B40", // ᭀ taling tedung, canonically U+1B3E U+1B35 and composed by NFC
  au: "\u1B41", // ᭁ taling repa tedung, canonically U+1B3F U+1B35 and composed by NFC
  e: "\u1B42", // ᭂ pepet
} as const;
export type Vowel = keyof typeof VOWEL_SIGNS;

// Pepet is never written on ra or la (r12a: "not used with ᬭ or ᬮ"). The letter stands alone at the
// start of a syllable; the sign attaches to the consonant before it inside a cluster, as in Krësna
// (Unicode Standard §17.3).
// TODO(verifikasi-ahli): Unicode also shows C + adeg adeg + ra repa for compounds ("Pak Rërëh").
// Notation cannot mark a compound boundary, so such words need an entry in exceptions.ts.
export const PEPET_FORMS: Partial<Record<Consonant, { letter: string; sign: string }>> = {
  r: { letter: "\u1B0B", sign: "\u1B3A" }, // ᬋ ra repa, ᬺ vowel sign ra repa
  l: { letter: "\u1B0D", sign: "\u1B3C" }, // ᬍ la lenga, ᬼ vowel sign la lenga
};

// Pangangge tengenan.
// TODO(verifikasi-ahli): r12a says cecek and bisah usually appear only word-finally, outside
// compounds and repetition. Rule §6.3 uses them at the end of any syllable, so Bangli gives ᬩᬂᬮᬶ.
export const CODA_SIGNS = {
  ng: "\u1B02", // ᬂ cecek
  r: "\u1B03", // ᬃ surang
  h: "\u1B04", // ᬄ bisah
} as const;
export type Coda = keyof typeof CODA_SIGNS;

// Aksara suara. Rule §6.3 keeps these out of the default path: they only arrive through exceptions.ts.
export const INDEPENDENT_VOWELS = {
  "\u1B05": "a", // ᬅ akara
  "\u1B07": "i", // ᬇ ikara
  "\u1B09": "u", // ᬉ ukara
  "\u1B0F": "é", // ᬏ ekara
  "\u1B11": "o", // ᬑ okara
} as const;

// Letters reached only through exceptions.ts, read back as their plain Latin value.
export const SPECIAL_CONSONANTS = {
  "\u1B31": "s", // ᬱ sa sapa
} as const;

export const DIGIT_ZERO = 0x1B50; // ᭐, U+1B50–U+1B59 run in order to ᭙

export type ForeignRule = { consonants: readonly Consonant[]; rerekan: boolean; unconfirmed: boolean };

// §5.4. Two-letter keys are matched before single letters.
export const FOREIGN_LETTERS: Readonly<Record<string, ForeignRule>> = {
  // Plain ka. r12a lists ᬓ᬴ for /x/, but calls rerekan specific to Lombok texts.
  kh: { consonants: ["k"], rerekan: false, unconfirmed: false },
  sy: { consonants: ["s"], rerekan: false, unconfirmed: false }, // §5.4
  x: { consonants: ["k", "s"], rerekan: false, unconfirmed: false }, // §5.4
  q: { consonants: ["k"], rerekan: false, unconfirmed: false }, // §5.4
  // TODO(verifikasi-ahli): rerekan for f, v, z. r12a lists ᬧ᬴ ᬯ᬴ ᬚ᬴ but calls the sign specific to
  // Lombok and "sporadic and inconsistent"; Wikipedia gives telepon, pitamin, ijasah with plain pa
  // and ja or sa. Being in doubt, §5.4 sends these tokens to unsupportedTokenIds.
  f: { consonants: ["p"], rerekan: true, unconfirmed: true },
  v: { consonants: ["w"], rerekan: true, unconfirmed: true },
  z: { consonants: ["j"], rerekan: true, unconfirmed: true },
};

export const REREKAN_LATIN: Partial<Record<Consonant, string>> = { p: "f", w: "v", j: "z" };

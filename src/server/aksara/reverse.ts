import "server-only";
import { normalizeNotation, readPhonemes, readSegments } from "./notation.ts";
import { ADEG_ADEG, CODA_SIGNS, CONSONANTS, DIGIT_ZERO, INDEPENDENT_VOWELS, PEPET_FORMS, REREKAN, REREKAN_LATIN, SPECIAL_CONSONANTS, VOWEL_SIGNS, type Consonant } from "./tables.ts";

function invert(table: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(table).filter(([, glyph]) => glyph).map(([latin, glyph]) => [glyph, latin]));
}

const LATIN_CONSONANTS = invert(CONSONANTS);
const LATIN_VOWEL_SIGNS = invert(VOWEL_SIGNS);
const LATIN_CODAS = invert(CODA_SIGNS);
const LATIN_INDEPENDENT = new Map<string, string>(Object.entries(INDEPENDENT_VOWELS));
const LATIN_SPECIAL = new Map<string, string>(Object.entries(SPECIAL_CONSONANTS));
const PEPET_LETTERS = new Map(Object.entries(PEPET_FORMS).map(([latin, forms]) => [forms.letter, `${latin}e`]));
const PEPET_SIGNS = new Map(Object.entries(PEPET_FORMS).map(([latin, forms]) => [forms.sign, `${latin}e`]));

function digitValue(char: string): number | null {
  const value = (char.codePointAt(0) ?? 0) - DIGIT_ZERO;
  return value >= 0 && value <= 9 ? value : null;
}

// Reads Balinese back to notation. A carrier ha at the start of a word is dropped, because the forward
// rule writes word-initial vowels that way; readingKey below accounts for the h this may hide.
export function reverseBalinese(balinese: string): string {
  const chars = [...balinese.normalize("NFC")];
  let latin = "";
  let index = 0;
  let wordStart = true;

  function readCodas() {
    while (LATIN_CODAS.has(chars[index])) {
      latin += LATIN_CODAS.get(chars[index]);
      index += 1;
    }
  }

  while (index < chars.length) {
    const char = chars[index];
    const digit = digitValue(char);
    if (char === " " || digit !== null) {
      latin += digit ?? " ";
      wordStart = true;
      index += 1;
    } else if (LATIN_INDEPENDENT.has(char) || PEPET_LETTERS.has(char)) {
      latin += LATIN_INDEPENDENT.get(char) ?? PEPET_LETTERS.get(char);
      wordStart = false;
      index += 1;
      readCodas();
    } else if (LATIN_CONSONANTS.has(char) || LATIN_SPECIAL.has(char)) {
      let consonant = LATIN_CONSONANTS.get(char) ?? LATIN_SPECIAL.get(char) ?? "";
      index += 1;
      if (chars[index] === REREKAN) {
        const foreign = REREKAN_LATIN[consonant as Consonant];
        if (!foreign) throw new Error(`Rerekan tidak dikenali pada posisi ${index}.`);
        consonant = foreign;
        index += 1;
      }
      if (chars[index] === ADEG_ADEG) {
        latin += consonant;
        wordStart = false;
        index += 1;
        continue;
      }
      const next = chars[index];
      const pepetCluster = PEPET_SIGNS.get(next);
      const vowel = pepetCluster ?? LATIN_VOWEL_SIGNS.get(next);
      if (vowel !== undefined) index += 1;
      latin += (wordStart && consonant === "h" ? "" : consonant) + (vowel ?? "a");
      wordStart = false;
      readCodas();
    } else {
      throw new Error(`Karakter tidak dikenali pada posisi ${index}.`);
    }
  }
  return latin;
}

const HIATUS = "·";

// ha carries a vowel at the start of a word and between vowels, so ᬳ cannot tell ari from hari, or dua
// from duha. Two readings with the same key are the same Balinese spelling.
function wordKey(word: string): string {
  const phonemes = readPhonemes(word);
  let key = "";
  phonemes.forEach((phoneme, index) => {
    const before = phonemes[index - 1];
    const after = phonemes[index + 1];
    const followsVowelOrStart = !before || before.kind === "vowel";
    if (phoneme.kind === "consonant" && phoneme.consonant === "h" && after?.kind === "vowel" && followsVowelOrStart) {
      if (before) key += HIATUS;
      return;
    }
    if (phoneme.kind === "vowel" && before?.kind === "vowel") key += HIATUS;
    key += phoneme.source;
  });
  return key;
}

function readingKey(notation: string): string {
  return readSegments(notation).map((segment) => segment.kind === "word" ? wordKey(segment.text) : segment.text).join("");
}

export type RoundTripCheck = { status: "pass" | "mismatch" | "error"; note: string; originalLatin: string; returnedLatin: string };

const PASS_NOTE = "Hasil balik sama dengan pelafalan pilihan (pemeriksaan teknis, bukan pemeriksaan bahasa).";
const AMBIGUOUS_NOTE = `${PASS_NOTE} Huruf ᬳ bisa dibaca dengan atau tanpa h, jadi pemeriksaan ini tidak dapat membedakan keduanya.`;
const MISMATCH_NOTE = "Hasil balik berbeda dari pelafalan pilihan. Huruf asing seperti x, q, kh, dan sy serta tanda baca tidak punya padanan satu lawan satu, sehingga sebagian bunyi berubah atau hilang. Ini pemeriksaan teknis, bukan pemeriksaan bahasa.";
const ERROR_NOTE = "Pemeriksaan balik gagal dijalankan pada hasil ini.";

export function checkRoundTrip(pronunciations: readonly string[], balineseUnicode: string): RoundTripCheck {
  const originalLatin = pronunciations.map(normalizeNotation).join(" ");
  let returnedLatin: string;
  try {
    returnedLatin = reverseBalinese(balineseUnicode);
  } catch {
    return { status: "error", note: ERROR_NOTE, originalLatin, returnedLatin: "" };
  }
  if (returnedLatin === originalLatin) return { status: "pass", note: PASS_NOTE, originalLatin, returnedLatin };
  if (readingKey(returnedLatin) === readingKey(originalLatin)) return { status: "pass", note: AMBIGUOUS_NOTE, originalLatin, returnedLatin: originalLatin };
  return { status: "mismatch", note: MISMATCH_NOTE, originalLatin, returnedLatin };
}

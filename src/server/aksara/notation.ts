import "server-only";
import { CODA_SIGNS, CONSONANTS, FOREIGN_LETTERS, type Coda, type Consonant, type Vowel } from "./tables.ts";

export const NOTATION_VERSION = "nyurat-notation-0.1";
export const MAX_NOTATION_CHARS = 120;

const VOWEL_LETTERS: ReadonlySet<string> = new Set<Vowel>(["a", "ā", "i", "ī", "u", "ū", "é", "o", "e"]);
const DIPHTHONGS: ReadonlySet<string> = new Set<Vowel>(["ai", "au"]);
const WORD_LETTERS: ReadonlySet<string> = new Set([...VOWEL_LETTERS, ..."hncrkdtswlmgbpjy", ..."fvzqx"]);

export type VowelPhoneme = { kind: "vowel"; vowel: Vowel; source: string };
export type ConsonantPhoneme = { kind: "consonant"; consonant: Consonant; rerekan: boolean; unconfirmed: boolean; source: string };
export type Phoneme = VowelPhoneme | ConsonantPhoneme;
export type Syllable = { onset: ConsonantPhoneme[]; vowel: Vowel | null; coda: Coda | null };
export type Segment = { kind: "word" | "digits" | "symbol" | "unknown" | "space"; text: string };

export function normalizeNotation(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("id").normalize("NFC").replaceAll("ə", "e").replaceAll("è", "é").trim().replace(/\s+/gu, " ");
}

function classify(char: string): Segment["kind"] {
  if (WORD_LETTERS.has(char)) return "word";
  if (/[0-9]/.test(char)) return "digits";
  if (/\s/u.test(char)) return "space";
  // Same class validateInput lets through, so an as-written option exists for every accepted name.
  return /[\p{Punctuation}+]/u.test(char) ? "symbol" : "unknown";
}

export function readSegments(notation: string): Segment[] {
  const segments: Segment[] = [];
  for (const char of notation) {
    const kind = classify(char);
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += char;
    else segments.push({ kind, text: char });
  }
  return segments;
}

// Symbols are legal here because §5.4 defines what happens to them. A token like "&" still needs an
// as-written option, and custom spaces are not: one option describes exactly one token.
export function isValidNotation(text: string): boolean {
  const notation = normalizeNotation(text);
  if (!notation || [...notation].length > MAX_NOTATION_CHARS) return false;
  return readSegments(notation).every((segment) => segment.kind !== "unknown" && segment.kind !== "space");
}

// Stricter gate for model output, which has no reason to contain anything but letters and digits.
export function isPhoneticNotation(text: string): boolean {
  return isValidNotation(text) && readSegments(normalizeNotation(text)).every((segment) => segment.kind === "word" || segment.kind === "digits");
}

function isVowelLetter(letter: string | undefined): boolean {
  return letter !== undefined && VOWEL_LETTERS.has(letter);
}

function nativeConsonant(consonant: Consonant, source: string): ConsonantPhoneme {
  return { kind: "consonant", consonant, rerekan: false, unconfirmed: false, source };
}

export function readPhonemes(word: string): Phoneme[] {
  const letters = [...word];
  const phonemes: Phoneme[] = [];
  let index = 0;
  while (index < letters.length) {
    const letter = letters[index];
    const pair = letter + (letters[index + 1] ?? "");
    if (DIPHTHONGS.has(pair)) {
      phonemes.push({ kind: "vowel", vowel: pair as Vowel, source: pair });
      index += 2;
    } else if (isVowelLetter(letter)) {
      phonemes.push({ kind: "vowel", vowel: letter as Vowel, source: letter });
      index += 1;
    } else if (pair === "ng" || (pair === "ny" && isVowelLetter(letters[index + 2]))) {
      // TODO(verifikasi-ahli): §6.3 treats ng as one consonant before a vowel or as a coda, and says
      // nothing of word-initial ng + consonant (nglawang). Kept as nga, not as n + ga: the sound is /ŋ/.
      phonemes.push(nativeConsonant(pair, pair));
      index += 2;
    } else if (Object.hasOwn(FOREIGN_LETTERS, pair) || Object.hasOwn(FOREIGN_LETTERS, letter)) {
      const source = Object.hasOwn(FOREIGN_LETTERS, pair) ? pair : letter;
      const rule = FOREIGN_LETTERS[source];
      // Only the first phoneme carries the source text, so x stays x when a reading is compared.
      rule.consonants.forEach((consonant, position) => phonemes.push({ kind: "consonant", consonant, rerekan: rule.rerekan, unconfirmed: rule.unconfirmed, source: position === 0 ? source : "" }));
      index += [...source].length;
    } else {
      phonemes.push(nativeConsonant(letter as keyof typeof CONSONANTS, letter));
      index += 1;
    }
  }
  return phonemes;
}

function canCloseSyllable(phoneme: ConsonantPhoneme | undefined): boolean {
  return phoneme !== undefined && !phoneme.rerekan && Object.hasOwn(CODA_SIGNS, phoneme.consonant);
}

export function syllabify(phonemes: Phoneme[]): Syllable[] {
  const syllables: Syllable[] = [];
  let index = 0;
  while (index < phonemes.length) {
    const cluster: ConsonantPhoneme[] = [];
    for (let next = phonemes[index]; next?.kind === "consonant"; next = phonemes[index]) {
      cluster.push(next);
      index += 1;
    }
    const nucleus = phonemes[index]?.kind === "vowel" ? phonemes[index] as VowelPhoneme : null;
    if (nucleus) index += 1;

    // A lone consonant before a vowel opens the next syllable; only surplus can close the previous one.
    const previous = syllables.at(-1);
    if (previous?.vowel && canCloseSyllable(cluster[0]) && (cluster.length > 1 || !nucleus)) {
      previous.coda = cluster.shift()?.consonant as Coda;
    }
    if (cluster.length > 0 || nucleus) syllables.push({ onset: cluster, vowel: nucleus?.vowel ?? null, coda: null });
  }
  return syllables;
}

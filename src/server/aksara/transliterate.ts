import "server-only";
import { EXCEPTIONS } from "./exceptions.ts";
import { normalizeNotation, readPhonemes, readSegments, syllabify, type ConsonantPhoneme, type Syllable } from "./notation.ts";
import { ADEG_ADEG, CODA_SIGNS, CONSONANTS, DIGIT_ZERO, PEPET_FORMS, REREKAN, VOWEL_SIGNS } from "./tables.ts";

export type TokenIssue = { kind: "symbol" | "unknown" | "unconfirmed"; text: string };
export type TransliteratedToken = { notation: string; balinese: string; supported: boolean; issues: TokenIssue[] };
export type TransliteratedName = { balineseUnicode: string; tokens: TransliteratedToken[] };

const OUTPUT_PATTERN = /^[\u1B00-\u1B7F ]*$/u;

// TODO(verifikasi-ahli): §6.3 makes ha the default carrier at the start of a word, while r12a says most
// word-initial vowels use an independent letter. r12a does use ha inside a word (ᬩᬳᬸ). Hiatus after i or
// u may instead take a ya or wa glide (dua as ᬤᬸᬯ); no accessible source settles that, so ha stays.
const VOWEL_CARRIER: ConsonantPhoneme = { kind: "consonant", consonant: "h", rerekan: false, unconfirmed: false, source: "" };

function renderConsonant(phoneme: ConsonantPhoneme): string {
  return CONSONANTS[phoneme.consonant] + (phoneme.rerekan ? REREKAN : "");
}

function renderCluster(consonants: ConsonantPhoneme[]): string {
  return consonants.map(renderConsonant).join(ADEG_ADEG);
}

function renderSyllable({ onset, vowel, coda }: Syllable): string {
  const consonants = onset.length > 0 ? onset : [VOWEL_CARRIER];
  const last = consonants[consonants.length - 1];
  const pepetForm = vowel === "e" && !last.rerekan ? PEPET_FORMS[last.consonant] : undefined;
  let text: string;
  if (pepetForm) {
    const head = consonants.slice(0, -1);
    text = head.length > 0 ? renderCluster(head) + pepetForm.sign : pepetForm.letter;
  } else {
    text = renderCluster(consonants) + (vowel === null ? ADEG_ADEG : VOWEL_SIGNS[vowel]);
  }
  return text + (coda ? CODA_SIGNS[coda] : "");
}

function renderWord(word: string, issues: TokenIssue[]): string {
  const exception = EXCEPTIONS.get(word);
  if (exception) return exception;
  const phonemes = readPhonemes(word);
  for (const phoneme of phonemes) {
    if (phoneme.kind === "consonant" && phoneme.unconfirmed && phoneme.source) issues.push({ kind: "unconfirmed", text: phoneme.source });
  }
  return syllabify(phonemes).map(renderSyllable).join("");
}

function renderDigits(digits: string): string {
  return [...digits].map((digit) => String.fromCodePoint(DIGIT_ZERO + Number(digit))).join("");
}

export function transliterateToken(pronunciation: string): TransliteratedToken {
  const notation = normalizeNotation(pronunciation);
  const issues: TokenIssue[] = [];
  const parts: string[] = [];
  for (const segment of readSegments(notation)) {
    if (segment.kind === "word") parts.push(renderWord(segment.text, issues));
    else if (segment.kind === "digits") parts.push(renderDigits(segment.text));
    else if (segment.kind === "space") parts.push(" ");
    else issues.push({ kind: segment.kind, text: segment.text });
  }
  const balinese = parts.join("").trim().normalize("NFC");
  if (!OUTPUT_PATTERN.test(balinese)) throw new Error("Keluaran mesin aksara memuat karakter di luar blok Bali.");
  return { notation, balinese, supported: issues.length === 0 && balinese.length > 0, issues };
}

export function transliterateName(pronunciations: readonly string[]): TransliteratedName {
  const tokens = pronunciations.map(transliterateToken);
  return { balineseUnicode: tokens.map((token) => token.balinese).filter(Boolean).join(" "), tokens };
}

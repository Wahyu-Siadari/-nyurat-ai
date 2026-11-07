import "server-only";
import { isValidNotation, MAX_NOTATION_CHARS, normalizeNotation, readPhonemes, readSegments } from "../aksara/notation.ts";
import { FOREIGN_LETTERS } from "../aksara/tables.ts";

export type ProposedOption = { pronunciation: string; reason: string };

// Keeps a character the notation cannot hold visible to §5.4, so its token is still marked unsupported.
const UNSUPPORTED_PLACEHOLDER = "-";
// validateInput accepts every Latin letter, and each needs an as-written option. Diacritics are dropped
// by NFKD; these letters have no decomposition.
const LETTER_FOLDS: Readonly<Record<string, string>> = { ñ: "ny", ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ł: "l", ı: "i", ŋ: "ng" };

const E_REASONS = {
  none: "Dibaca seperti ditulis.",
  asWritten: "Dibaca seperti ditulis; huruf e sebagai pepet (ə).",
  allTaling: "Huruf e sebagai taling (é).",
  lastTaling: "Huruf e terakhir sebagai taling (é), lainnya pepet (ə).",
  firstTaling: "Huruf e pertama sebagai taling (é), lainnya pepet (ə).",
} as const;
const SYMBOL_NOTE = "Tanda baca dan simbol tidak ditulis dalam aksara, jadi token ini ditandai belum didukung. Kamu bisa menulis pelafalannya sendiri.";

export function tokenize(latinName: string): string[] {
  return latinName.match(/\S+/gu) ?? [];
}

function foldChar(char: string): string {
  const folded = LETTER_FOLDS[char] ?? char.normalize("NFKD").replace(/\p{Mark}/gu, "").toLocaleLowerCase("id");
  return [...folded].map((part) => isValidNotation(part) ? part : UNSUPPORTED_PLACEHOLDER).join("");
}

export function foldToNotation(word: string): { notation: string; simplified: boolean } {
  const normalized = normalizeNotation(word);
  const folded = [...normalized].map((char) => isValidNotation(char) ? char : foldChar(char)).join("");
  const notation = [...folded].slice(0, MAX_NOTATION_CHARS).join("") || UNSUPPORTED_PLACEHOLDER;
  return { notation, simplified: notation !== normalized };
}

function withTaling(chars: string[], positions: number[]): string {
  return chars.map((char, index) => positions.includes(index) ? "é" : char).join("");
}

// §5.3: at most 4 options, all-pepet first and all-taling second. For the mixed forms, a final-syllable
// e is more often taling (tempe, gede), so that one leads.
function eVariants(notation: string): Array<{ text: string; reason: string }> {
  const chars = [...notation];
  const positions = chars.flatMap((char, index) => char === "e" ? [index] : []);
  if (positions.length === 0) return [{ text: notation, reason: E_REASONS.none }];
  const variants = [
    { text: notation, reason: E_REASONS.asWritten },
    { text: withTaling(chars, positions), reason: E_REASONS.allTaling },
    { text: withTaling(chars, positions.slice(-1)), reason: E_REASONS.lastTaling },
    { text: withTaling(chars, positions.slice(0, 1)), reason: E_REASONS.firstTaling },
  ];
  return variants.filter((variant, index) => variants.findIndex((other) => other.text === variant.text) === index);
}

function foreignNote(source: string): string | null {
  if (!Object.hasOwn(FOREIGN_LETTERS, source)) return null;
  const rule = FOREIGN_LETTERS[source];
  if (rule.unconfirmed) return `Huruf ${source} memakai rerekan yang belum dikonfirmasi, jadi token ini ditandai belum didukung.`;
  return `Huruf ${source} ditulis sebagai ${rule.consonants.join("")}.`;
}

function tokenNotes(notation: string, simplified: boolean): string[] {
  const segments = readSegments(notation);
  const sources = new Set(segments.filter((segment) => segment.kind === "word").flatMap((segment) => readPhonemes(segment.text).map((phoneme) => phoneme.source)));
  const notes = [...sources].flatMap((source) => foreignNote(source) ?? []);
  if (segments.some((segment) => segment.kind === "symbol")) notes.push(SYMBOL_NOTE);
  if (simplified) notes.push("Huruf di luar notasi disederhanakan.");
  return notes;
}

function baseReason(notation: string, eReason: string): string[] {
  const kinds = new Set(readSegments(notation).map((segment) => segment.kind));
  if (kinds.has("word")) return [eReason];
  return kinds.has("digits") ? ["Angka ditulis dengan angka Bali."] : [];
}

export function proposeByRules(word: string): ProposedOption[] {
  const { notation, simplified } = foldToNotation(word);
  const notes = tokenNotes(notation, simplified);
  return eVariants(notation).map(({ text, reason }) => ({ pronunciation: text, reason: [...baseReason(text, reason), ...notes].join(" ") }));
}

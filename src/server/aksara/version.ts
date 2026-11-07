import "server-only";

export const ENGINE_VERSION = "nyurat-aksara-engine-0.1.0";

// "word-space" records the signboard decision to separate tokens with U+0020. Balinese text itself
// does not separate words, so an expert still has to confirm this choice.
export const RULES_VERSION = "nyurat-aksara-rules-0.1.0+word-space";

// Shown to users as the basis of a result, so documents that were not read say so.
export const SOURCE_REFS: readonly string[] = [
  "Unicode Standard 18.0 §17.3 dan code chart Balinese U+1B00–U+1B7F",
  "r12a, catatan ortografi Bali: pepet pada ra/la, ha pembawa vokal, rerekan",
  "Belum diakses, perlu verifikasi ahli: pedoman pasang aksara Bali, Badan Pembina Bahasa, Aksara, dan Sastra Bali",
  "Belum diakses, perlu verifikasi ahli: The Balinese Alphabet",
  "Belum diakses, perlu verifikasi ahli: Kamus Bali–Indonesia Beraksara Latin dan Bali (Anom dkk., 2009)",
  "Konvensi perlu dikonfirmasi: f, v, z dengan rerekan U+1B34",
];

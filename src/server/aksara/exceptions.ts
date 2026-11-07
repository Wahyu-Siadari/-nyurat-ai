import "server-only";

// Pasang pageh, keyed by normalized notation and matched against whole words only.
// Add an entry only with a citable source.
export const EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  // Master prompt §6.3 and §6.5, and SAMPLE_BALINESE in src/lib/project.ts.
  ["aksara", "\u1B05\u1B13\u1B44\u1B31\u1B2D"], // ᬅᬓ᭄ᬱᬭ
]);

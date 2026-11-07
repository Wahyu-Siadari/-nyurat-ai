import "server-only";
import { ServiceError } from "../../lib/contract.ts";

export const ERROR_CATALOG = {
  INVALID_INPUT: { status: 400, retryable: false, message: "Data yang dikirim belum valid. Periksa isian lalu coba lagi." },
  NOT_FOUND: { status: 404, retryable: false, message: "Alamat layanan tidak ditemukan." },
  METHOD_NOT_ALLOWED: { status: 405, retryable: false, message: "Metode permintaan ini tidak didukung." },
  STALE_REVISION: { status: 409, retryable: false, message: "Pratinjau mengacu pada hasil lama. Perbarui pratinjau terlebih dahulu." },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: "Ukuran data melewati batas yang diizinkan." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, retryable: false, message: "Jenis data ini tidak didukung." },
  RATE_LIMITED: { status: 429, retryable: true, message: "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi." },
  QUOTA_EXHAUSTED: { status: 429, retryable: true, message: "Kuota layanan AI sedang habis. Coba lagi nanti." },
  AI_TIMEOUT: { status: 504, retryable: true, message: "Layanan AI terlalu lama merespons. Coba lagi." },
  UPSTREAM_UNAVAILABLE: { status: 503, retryable: true, message: "Layanan AI belum tersedia. Coba lagi nanti." },
  EXPORT_FAILED: { status: 500, retryable: true, message: "Berkas belum berhasil dibuat. Pratinjau dan pilihanmu tetap tersedia." },
  INTERNAL_ERROR: { status: 500, retryable: true, message: "Terjadi kendala pada layanan. Coba lagi." },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

function isErrorCode(code: string): code is ErrorCode { return Object.hasOwn(ERROR_CATALOG, code); }

// `message` reaches the user, so it must never carry stack traces, file names, prompts, or keys.
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(code: ErrorCode, message?: string, options: { retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(message ?? ERROR_CATALOG[code].message, { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.retryable = ERROR_CATALOG[code].retryable;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  // ServiceError text is written by this codebase for display, unlike the message of an arbitrary Error.
  if (error instanceof ServiceError && isErrorCode(error.code)) return new ApiError(error.code, error.message, { cause: error });
  return new ApiError("INTERNAL_ERROR", undefined, { cause: error });
}

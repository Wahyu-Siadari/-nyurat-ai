import { z } from "zod";
import { provenanceSchema, ServiceError } from "./contract.ts";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 24_000_000;

export function validatePhotoFile(file: { type: string; size: number; name: string }): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Gunakan gambar JPG, PNG, atau WebP.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "Berkas gambar kosong atau tidak valid. Pilih foto lain.";
  if (file.size > MAX_PHOTO_BYTES) return "Ukuran foto maksimal 10 MB. Kompres foto lalu coba lagi.";
  return null;
}

export function validatePhotoDimensions(width: number, height: number): string | null {
  if (![width, height].every((value) => Number.isFinite(value) && Number.isInteger(value) && value >= 64)) return "Gambar minimal 64 × 64 piksel. Pilih foto papan yang lebih jelas.";
  if (width * height > MAX_PHOTO_PIXELS) return "Resolusi foto maksimal 24 megapiksel. Kecilkan gambar lalu coba lagi.";
  return null;
}

const boxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine((box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001, "Kotak harus berada di dalam gambar.");
export const photoAnalysisSchema = z.object({
  analysisId: z.string().min(1), photoRevision: z.number().int().positive(),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  status: z.enum(["detected", "no_detection", "uncertain"]),
  detections: z.array(z.object({ id: z.string().min(1), script: z.enum(["latin", "balinese"]), text: z.string(), box: boxSchema, uncertain: z.boolean() })).max(200),
  note: z.string(), provenance: provenanceSchema,
}).refine((result) => new Set(result.detections.map((item) => item.id)).size === result.detections.length, "ID area tulisan harus unik.").refine((result) => result.status !== "no_detection" || result.detections.length === 0, "Status tanpa deteksi tidak boleh memuat kotak tulisan.");
export type PhotoAnalysis = z.infer<typeof photoAnalysisSchema>;
export type AuditFixtureScenario = "balanced" | "missing_bali" | "no_detection" | "uncertain";

export function getAuditSummary(result: PhotoAnalysis): { latinCount: number; balineseCount: number; ratio: number | null; position: "bali_above" | "latin_above" | "unclear" | "unavailable"; note: string } {
  const latin = result.detections.filter((item) => item.script === "latin");
  const bali = result.detections.filter((item) => item.script === "balinese");
  const primaryLatin = [...latin].sort((a, b) => b.box.height - a.box.height)[0];
  const primaryBali = [...bali].sort((a, b) => b.box.height - a.box.height)[0];
  const available = primaryLatin && primaryBali && result.status === "detected" && !primaryBali.uncertain && !primaryLatin.uncertain;
  return { latinCount: latin.length, balineseCount: bali.length,
    ratio: available ? primaryBali.box.height / primaryLatin.box.height : null,
    position: !available ? "unavailable" : primaryBali.box.y + primaryBali.box.height <= primaryLatin.box.y ? "bali_above" : primaryLatin.box.y + primaryLatin.box.height <= primaryBali.box.y ? "latin_above" : "unclear",
    note: "Rasio membandingkan tinggi kotak teks pada gambar; bukan ukuran font, ukuran fisik papan, atau penilaian kepatuhan.",
  };
}

export async function requestPhotoAudit(file: File, photoRevision: number, signal: AbortSignal): Promise<PhotoAnalysis> {
  const body = new FormData(); body.append("photo", file); body.append("photoRevision", String(photoRevision));
  let response: Response;
  try { response = await fetch("/api/v1/photo-audits", { method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }); }
  catch { throw new ServiceError("AUDIT_UNAVAILABLE", "Analisis foto belum dapat dihubungi. Foto tetap tersedia; coba lagi setelah layanan siap."); }
  let raw: unknown;
  try { raw = await response.json(); } catch {
    throw new ServiceError("INVALID_AUDIT_OUTPUT", response.ok ? "Hasil analisis belum dapat dibaca. Coba lagi." : "Layanan audit belum tersedia. Foto tetap tersedia untuk dicoba lagi.");
  }
  const envelope = z.object({ ok: z.boolean(), data: photoAnalysisSchema.optional(), error: z.object({ message: z.string() }).optional() }).safeParse(raw);
  if (!response.ok || !envelope.success || !envelope.data.ok || !envelope.data.data) throw new ServiceError("AUDIT_UNAVAILABLE", "Analisis belum berhasil. Foto tetap tersedia untuk dicoba lagi.");
  if (envelope.data.data.photoRevision !== photoRevision) throw new ServiceError("STALE_REVISION", "Hasil analisis berasal dari foto sebelumnya.");
  return envelope.data.data;
}

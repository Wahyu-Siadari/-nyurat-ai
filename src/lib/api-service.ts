import { z } from "zod";
import { exportFileSchema, proposalSchema, renderResultSchema, ServiceError, type NyuratService, type ProjectDraft } from "./contract.ts";

const envelopeSchema = z.object({ ok: z.boolean(), schemaVersion: z.literal("0.1-draft"), requestId: z.string(), projectId: z.string().optional(), revision: z.number().int().optional(), data: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }).optional() });

// Backend routes use the same origin as the frontend.
export function createApiService(baseUrl = "/api/v1"): NyuratService {
  async function request<T>(path: string, project: ProjectDraft, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: project.schemaVersion, projectId: project.projectId, revision: project.revision, project }), signal: AbortSignal.timeout(15000) });
    } catch {
      throw new ServiceError("UPSTREAM_UNAVAILABLE", "Layanan belum dapat dihubungi. Pilihanmu tetap tersedia; coba lagi setelah layanan siap.");
    }
    let raw: unknown;
    try { raw = await response.json(); } catch {
      throw new ServiceError("INVALID_API_OUTPUT", response.ok ? "Hasil belum dapat dibaca. Coba lagi." : "Layanan belum tersedia. Coba lagi nanti.");
    }
    const envelope = envelopeSchema.safeParse(raw);
    if (!envelope.success) throw new ServiceError("INVALID_API_OUTPUT", "Struktur respons layanan belum sesuai kontrak.");
    if (!response.ok || !envelope.data.ok) throw new ServiceError(envelope.data.error?.code ?? "UPSTREAM_UNAVAILABLE", envelope.data.error?.message ?? "Layanan belum tersedia.");
    if (envelope.data.projectId !== project.projectId || envelope.data.revision !== project.revision) throw new ServiceError("STALE_REVISION", "Hasil layanan mengacu pada revisi proyek yang berbeda.");
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) throw new ServiceError("INVALID_API_OUTPUT", "Isi respons layanan belum sesuai kontrak.");
    return data.data;
  }
  return {
    suggestPronunciation: (project) => request("pronunciation-proposals", project, proposalSchema),
    renderBoard: (project) => request("board-renders", project, renderResultSchema),
    createReviewPackage: (project) => request("review-packages", project, exportFileSchema),
    exportBoard: (project) => request("exports", project, exportFileSchema),
  };
}

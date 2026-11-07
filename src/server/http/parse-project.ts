import "server-only";
import { z } from "zod";
import { projectDraftSchema, type ProjectDraft } from "../../lib/contract.ts";
import { ApiError } from "./errors.ts";

export const MAX_JSON_BODY_BYTES = 256 * 1024;

const requestSchema = z.object({
  schemaVersion: z.literal("0.1-draft"),
  projectId: z.uuid(),
  revision: z.number().int().positive(),
  project: projectDraftSchema,
});

export type ProjectRequest = { projectId: string; revision: number; project: ProjectDraft };

function assertJsonContentType(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Kirim data sebagai application/json.");
}

// Content-Length is only a hint a client may omit or understate, so the stream is counted too.
export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError("PAYLOAD_TOO_LARGE");
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (cause) {
    throw new ApiError("INVALID_INPUT", "Isi permintaan bukan JSON yang valid.", { cause });
  }
}

export async function parseProjectRequest(request: Request): Promise<ProjectRequest> {
  assertJsonContentType(request);
  const raw = decodeJson(await readLimitedBody(request, MAX_JSON_BODY_BYTES));
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("INVALID_INPUT", "Data draf tidak lengkap atau belum valid.");
  const { projectId, revision, project } = parsed.data;
  if (project.projectId !== projectId || project.revision !== revision) throw new ApiError("INVALID_INPUT", "Identitas atau revisi draf tidak cocok.");
  return { projectId, revision, project };
}

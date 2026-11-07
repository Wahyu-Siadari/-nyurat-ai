import "server-only";
import { getConfig } from "../config.ts";
import { ApiError, toApiError } from "./errors.ts";
import { clientKey, rateLimiter } from "./rate-limit.ts";

export const SCHEMA_VERSION = "0.1-draft";

function baseHeaders(requestId: string): Record<string, string> {
  return { "X-Request-Id": requestId, "Cache-Control": "no-store" };
}

export function successResponse(requestId: string, projectId: string, revision: number, data: unknown): Response {
  return Response.json({ ok: true, schemaVersion: SCHEMA_VERSION, requestId, projectId, revision, data }, { headers: baseHeaders(requestId) });
}

// Photo audits belong to no project draft, so their envelope carries no projectId or revision.
export function dataResponse(requestId: string, data: unknown): Response {
  return Response.json({ ok: true, schemaVersion: SCHEMA_VERSION, requestId, data }, { headers: baseHeaders(requestId) });
}

export function errorResponse(requestId: string, error: ApiError, extraHeaders: Record<string, string> = {}): Response {
  const headers = { ...baseHeaders(requestId), ...extraHeaders };
  if (error.retryAfterSeconds !== null) headers["Retry-After"] = String(error.retryAfterSeconds);
  return Response.json({ ok: false, schemaVersion: SCHEMA_VERSION, requestId, error: { code: error.code, message: error.message, retryable: error.retryable } }, { status: error.status, headers });
}

// Other 4xx are the client's own mistakes, but a provider quota failure has to be traceable.
function logFailure(requestId: string, error: ApiError) {
  if (error.status < 500 && error.code !== "QUOTA_EXHAUSTED") return;
  const cause = error.cause instanceof Error ? error.cause.stack ?? error.cause.message : error.cause;
  console.error(`[nyurat] ${requestId} ${error.code}`, cause ?? error.message);
}

function enforceRateLimit(request: Request, weight: number) {
  const decision = rateLimiter.consume(clientKey(request.headers), weight, getConfig().rateLimitPerMinute);
  if (!decision.allowed) throw new ApiError("RATE_LIMITED", undefined, { retryAfterSeconds: decision.retryAfterSeconds });
}

export type RouteContext = { request: Request; requestId: string };

// Every failure path, expected or not, must leave as a JSON envelope: the frontend shows only a
// generic message for anything else.
export function createPostHandler(handler: (context: RouteContext) => Promise<Response>, options: { rateWeight?: number } = {}) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      enforceRateLimit(request, options.rateWeight ?? 1);
      return await handler({ request, requestId });
    } catch (cause) {
      const error = toApiError(cause);
      logFailure(requestId, error);
      return errorResponse(requestId, error);
    }
  };
}

// Without these exports Next.js answers other methods itself, with an empty non-JSON body.
export async function methodNotAllowed(): Promise<Response> {
  return errorResponse(crypto.randomUUID(), new ApiError("METHOD_NOT_ALLOWED"), { Allow: "POST" });
}

export async function notFound(): Promise<Response> {
  return errorResponse(crypto.randomUUID(), new ApiError("NOT_FOUND"));
}

import { PHOTO_AUDIT_RATE_WEIGHT } from "../../../../server/config.ts";
import { fixtureAudit, isFixtureMode } from "../../../../server/fixture.ts";
import { createPostHandler, dataResponse, methodNotAllowed } from "../../../../server/http/envelope.ts";
import { analyzePhoto } from "../../../../server/photo/gemini-detector.ts";
import { inspectPhoto, parsePhotoRequest } from "../../../../server/photo/inspect.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export const POST = createPostHandler(async ({ request, requestId }) => {
  const { bytes, photoRevision } = await parsePhotoRequest(request);
  if (isFixtureMode()) return dataResponse(requestId, fixtureAudit(bytes, photoRevision));
  const photo = await inspectPhoto(bytes);
  return dataResponse(requestId, await analyzePhoto(bytes, photo, photoRevision, requestId));
}, { rateWeight: PHOTO_AUDIT_RATE_WEIGHT });

export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;

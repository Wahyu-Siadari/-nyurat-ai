import { renderBoard } from "../../../../server/board/render.ts";
import { fixtureRender, isFixtureMode } from "../../../../server/fixture.ts";
import { createPostHandler, methodNotAllowed, successResponse } from "../../../../server/http/envelope.ts";
import { parseProjectRequest } from "../../../../server/http/parse-project.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const POST = createPostHandler(async ({ request, requestId }) => {
  const { projectId, revision, project } = await parseProjectRequest(request);
  const data = isFixtureMode() ? await fixtureRender(project) : renderBoard(project);
  return successResponse(requestId, projectId, revision, data);
});

export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;

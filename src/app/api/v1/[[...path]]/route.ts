import { notFound } from "../../../../server/http/envelope.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exact routes win over this one. It only keeps unknown addresses from falling through to Next.js's
// HTML 404, which the frontend could not read.
export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;

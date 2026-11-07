import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exportFileSchema, type ExportFile, type ProjectDraft } from "../../lib/contract.ts";
import { buildReviewPackage, buildSvg } from "../../lib/project.ts";
import { NOTATION_VERSION } from "../aksara/notation.ts";
import { ENGINE_VERSION, RULES_VERSION } from "../aksara/version.ts";
import { ApiError } from "../http/errors.ts";
import { verifiedSnapshot } from "./render.ts";

const MAX_SLUG_CHARS = 40;
const FONT_FILES = { balinese: "noto-sans-balinese-balinese-400-normal.woff2", latin: "ibm-plex-sans-latin-400-normal.woff2" };

type FontData = { balinese: string; latin: string };
let fonts: Promise<FontData> | null = null;

async function encodeFont(filename: string): Promise<string> {
  const font = await readFile(join(process.cwd(), "public", "fonts", filename));
  return `data:font/woff2;base64,${font.toString("base64")}`;
}

export function loadFonts(): Promise<FontData> {
  fonts ??= Promise.all([encodeFont(FONT_FILES.balinese), encodeFont(FONT_FILES.latin)])
    .then(([balinese, latin]) => ({ balinese, latin }))
    .catch((error: unknown) => {
      fonts = null;
      throw error;
    });
  return fonts;
}

export function slugify(name: string): string {
  const slug = name.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, MAX_SLUG_CHARS).replace(/-+$/, "");
  return slug || "draf";
}

export async function asExportFailure(build: () => ExportFile | Promise<ExportFile>): Promise<ExportFile> {
  try {
    return exportFileSchema.parse(await build());
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError("EXPORT_FAILED", undefined, { cause });
  }
}

export function buildSvgExport(project: ProjectDraft): Promise<ExportFile> {
  return asExportFailure(async () => {
    const snapshot = verifiedSnapshot(project);
    return { filename: `nyurat-papan-${slugify(snapshot.input.latinName)}-r${snapshot.revision}.svg`, mimeType: "image/svg+xml", contents: buildSvg(snapshot, await loadFonts()) };
  });
}

export function buildReviewExport(project: ProjectDraft, requestId: string, generatedAt = new Date().toISOString()): Promise<ExportFile> {
  return asExportFailure(() => {
    const snapshot = verifiedSnapshot(project);
    const backend = { engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, notationVersion: NOTATION_VERSION, generatedAt, requestId };
    return { filename: `nyurat-paket-pemeriksaan-${slugify(snapshot.input.latinName)}-r${snapshot.revision}.json`, mimeType: "application/json", contents: JSON.stringify({ ...buildReviewPackage(snapshot), backend }, null, 2) };
  });
}

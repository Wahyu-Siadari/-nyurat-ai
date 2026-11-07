import "server-only";
import { createHash } from "node:crypto";
import { proposalSchema, renderResultSchema, type ExportFile, type ProjectDraft, type Proposal, type RenderResult } from "../lib/contract.ts";
import { createFixtureAudit, fixtureService } from "../lib/mock.ts";
import type { PhotoAnalysis } from "../lib/photo-audit.ts";
import { buildSvg, validateSnapshot } from "../lib/project.ts";
import { asExportFailure, loadFonts } from "./board/export.ts";
import { getConfig } from "./config.ts";
import { ApiError } from "./http/errors.ts";

// Digest of tests/fixtures/papan-warung-sari-contoh.png, so a demo build does not have to ship tests/.
const SAMPLE_PHOTO_SHA256 = "80d581703d2cf8ebe2254663d5442a93fade40a833950d38d8ac375be5ac4f1b";

export function isFixtureMode(): boolean {
  return getConfig().mode === "fixture";
}

export async function fixtureProposal(project: ProjectDraft): Promise<Proposal> {
  return proposalSchema.parse(await fixtureService.suggestPronunciation(project, "normal"));
}

export async function fixtureRender(project: ProjectDraft): Promise<RenderResult> {
  return renderResultSchema.parse(await fixtureService.renderBoard(project, "normal"));
}

function assertSnapshot(project: ProjectDraft) {
  const invalid = validateSnapshot(project);
  if (invalid) throw new ApiError("STALE_REVISION", invalid);
}

export function fixtureSvgExport(project: ProjectDraft): Promise<ExportFile> {
  return asExportFailure(async () => {
    assertSnapshot(project);
    return { filename: "nyurat-papan-contoh.svg", mimeType: "image/svg+xml", contents: buildSvg(project, await loadFonts()) };
  });
}

export function fixtureReviewExport(project: ProjectDraft): Promise<ExportFile> {
  return asExportFailure(() => {
    assertSnapshot(project);
    return fixtureService.createReviewPackage(project);
  });
}

export function fixtureAudit(bytes: Buffer, photoRevision: number): PhotoAnalysis {
  if (createHash("sha256").update(bytes).digest("hex") !== SAMPLE_PHOTO_SHA256) throw new ApiError("INVALID_INPUT", "Mode contoh hanya menerima foto contoh bawaan. Foto lain perlu layanan audit asli.");
  return createFixtureAudit("balanced", photoRevision);
}

import type { ProjectDraft } from "./contract.ts";
import { validateSnapshot } from "./project.ts";

export type ReviewRecord = {
  reviewId: string;
  status: "requested" | "changes_requested" | "demo_approved";
  simulation: true;
  languageVerification: "unverified";
  snapshot: { projectId: string; revision: number; inputRevision: number; layoutRevision: number; resultId: string; renderId: string; latinName: string };
  requestNotes: string;
  decisionNotes: string;
  reviewerName?: string;
  requestedAt: string;
  decidedAt: string | null;
};

export function createReviewRequest(project: ProjectDraft, notes: string, now = new Date().toISOString()): ReviewRecord {
  const invalid = validateSnapshot(project); if (invalid) throw new Error(invalid);
  return { reviewId: `demo-review-${project.revision}-${now}`, status: "requested", simulation: true, languageVerification: "unverified",
    snapshot: { projectId: project.projectId, revision: project.revision, inputRevision: project.input.inputRevision, layoutRevision: project.layout.layoutRevision, resultId: project.transliteration!.resultId, renderId: project.render!.renderId, latinName: project.input.latinName },
    requestNotes: notes.trim(), decisionNotes: "", requestedAt: now, decidedAt: null };
}

export function reviewMatchesProject(record: ReviewRecord, project: ProjectDraft): boolean {
  return !validateSnapshot(project) && record.snapshot.projectId === project.projectId && record.snapshot.revision === project.revision && record.snapshot.inputRevision === project.input.inputRevision && record.snapshot.layoutRevision === project.layout.layoutRevision && record.snapshot.resultId === project.transliteration?.resultId && record.snapshot.renderId === project.render?.renderId;
}

export function decideReview(record: ReviewRecord, project: ProjectDraft, decision: "changes_requested" | "demo_approved", notes: string, now = new Date().toISOString()): ReviewRecord {
  if (!reviewMatchesProject(record, project)) throw new Error("Draf berubah. Buat permintaan untuk revisi terbaru sebelum memberi keputusan.");
  if (record.status !== "requested") throw new Error("Permintaan ini sudah memiliki keputusan. Buat permintaan baru untuk meninjau kembali.");
  if (decision === "changes_requested" && !notes.trim()) throw new Error("Tulis catatan perubahan yang diperlukan.");
  return { ...record, status: decision, decisionNotes: notes.trim(), decidedAt: now, simulation: true, languageVerification: "unverified" };
}

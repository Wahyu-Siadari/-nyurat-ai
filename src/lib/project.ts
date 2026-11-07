import type { Input, Layout, ProjectDraft, Selection } from "./contract.ts";

export const SAMPLE_NOTICE = "Sampel aksara tetap untuk uji tata letak; bukan alih aksara nama ini.";
export const DRAFT_NOTICE = "Data contoh pengembangan · Belum diperiksa ahli";
export const SAMPLE_BALINESE = "ᬅᬓ᭄ᬱᬭ ᬩᬮᬶ";
export const DEFAULT_LAYOUT: Layout = { layoutRevision: 1, boardMm: { width: 1200, height: 400 }, marginMm: 40, balineseSizeMm: 82, latinSizeMm: 55, alignment: "center", lineBreaks: "single" };
const INITIAL_CHECKS: ProjectDraft["checks"] = {
  roundTrip: { status: "not_run", note: "Pemeriksaan balik belum dijalankan." },
  layout: { status: "not_run", findings: [] },
};

export function isLayoutSample(project: ProjectDraft): boolean { return !project.transliteration || project.transliteration.kind === "layout_sample" || !project.transliteration.matchesInput; }
export function getBoardNotice(project: ProjectDraft): string { return isLayoutSample(project) ? SAMPLE_NOTICE : "Alih aksara dari layanan; belum diperiksa ahli."; }
export function getDraftNotice(project: ProjectDraft): string { return project.transliteration?.provenance.producer === "fixture" ? DRAFT_NOTICE : "Draf · Belum diperiksa ahli"; }

export function createInitialProject(): ProjectDraft {
  return {
    schemaVersion: "0.1-draft", projectId: crypto.randomUUID(), revision: 1, mode: "new_board",
    input: { inputRevision: 1, latinName: "", businessType: null, sourceLanguage: null },
    proposal: null, confirmation: null, transliteration: null,
    layout: structuredClone(DEFAULT_LAYOUT), render: null,
    checks: structuredClone(INITIAL_CHECKS),
    languageReview: { status: "unreviewed", evidence: null }, artifacts: [],
  };
}

export function validateInput(input: Input): string | null {
  if (!input.latinName.trim()) return "Isi nama usaha terlebih dahulu.";
  if ([...input.latinName].length > 120) return "Nama maksimal 120 karakter.";
  if (!/^[\p{Script=Latin}\p{Mark}\p{Number}\p{Punctuation}\p{Separator}\s+&]+$/u.test(input.latinName)) return "Gunakan nama berhuruf Latin.";
  return null;
}

export function validateLayout(layout: Layout): string | null {
  const { width, height } = layout.boardMm;
  if (![width, height, layout.marginMm, layout.balineseSizeMm, layout.latinSizeMm].every(Number.isFinite)) return "Isi semua ukuran dengan angka yang valid.";
  if (width < 100 || height < 100 || width > 10000 || height > 10000) return "Lebar dan tinggi harus 100 sampai 10000 mm.";
  if (layout.marginMm < 0 || layout.marginMm * 2 >= Math.min(width, height)) return "Margin harus menyisakan bidang papan.";
  if (layout.balineseSizeMm < 5 || layout.latinSizeMm < 5 || layout.balineseSizeMm > 500 || layout.latinSizeMm > 500) return "Ukuran teks harus 5 sampai 500 mm.";
  return null;
}

export function invalidateInput(project: ProjectDraft, values: Omit<Input, "inputRevision">): ProjectDraft {
  return { ...project, revision: project.revision + 1, input: { ...values, inputRevision: project.input.inputRevision + 1 }, proposal: null, confirmation: null, transliteration: null, render: null, artifacts: [], languageReview: { status: "unreviewed", evidence: null }, checks: structuredClone(INITIAL_CHECKS) };
}

export function invalidateConfirmation(project: ProjectDraft): ProjectDraft {
  return { ...project, revision: project.revision + 1, confirmation: null, transliteration: null, render: null, artifacts: [], languageReview: { status: "unreviewed", evidence: null }, checks: structuredClone(INITIAL_CHECKS) };
}

export function updateLayout(project: ProjectDraft, layout: Layout): ProjectDraft {
  return { ...project, revision: project.revision + 1, layout: { ...layout, layoutRevision: project.layout.layoutRevision + 1 }, render: null, artifacts: [], checks: { ...project.checks, layout: { status: "not_run", findings: [] } } };
}

export function selectedPronunciations(project: ProjectDraft, selections: Selection[]): string[] {
  if (!project.proposal) return [];
  return project.proposal.tokens.map((token) => {
    const selection = selections.find((item) => item.tokenId === token.tokenId);
    if (!selection) return "";
    if (selection.kind === "custom") return selection.pronunciation.trim();
    return token.options.find((option) => option.optionId === selection.optionId)?.pronunciation ?? "";
  });
}

export function validateSelections(project: ProjectDraft, selections: Selection[]): string | null {
  if (!project.proposal || project.proposal.inputRevision !== project.input.inputRevision) return "Muat ulang usulan untuk nama terbaru.";
  if (selections.length !== project.proposal.tokens.length || new Set(selections.map((item) => item.tokenId)).size !== selections.length) return "Pilih pelafalan untuk setiap token.";
  const values = selectedPronunciations(project, selections);
  if (values.some((value) => !value || [...value].length > 120)) return "Isi pilihan pelafalan yang valid untuk setiap token.";
  return null;
}

export function confirmProject(project: ProjectDraft, selections: Selection[], now = new Date().toISOString()): ProjectDraft {
  const error = validateSelections(project, selections);
  if (error) throw new Error(error);
  const revision = project.revision + 1;
  return { ...project, revision, confirmation: { confirmationId: `confirmation-${revision}`, proposalId: project.proposal!.proposalId, inputRevision: project.input.inputRevision, selections: structuredClone(selections), confirmedAt: now }, transliteration: null, render: null, artifacts: [] };
}

export function getBoardModel(project: ProjectDraft) {
  const { boardMm: { width, height }, marginMm, balineseSizeMm, latinSizeMm, alignment, lineBreaks } = project.layout;
  const words = project.input.latinName.trim().split(/\s+/u);
  const split = Math.ceil(words.length / 2);
  const latinLines = lineBreaks === "two_lines" && words.length > 1 ? [words.slice(0, split).join(" "), words.slice(split).join(" ")] : [project.input.latinName];
  const x = alignment === "center" ? width / 2 : marginMm;
  const anchor = alignment === "center" ? "middle" as const : "start" as const;
  const sampleY = height / 2 - (latinLines.length * latinSizeMm * 1.2) / 2 - balineseSizeMm * 0.1;
  const latinY = sampleY + balineseSizeMm * 0.75 + latinSizeMm;
  return {
    width, height, x, anchor,
    sample: { text: project.transliteration?.balineseUnicode ?? SAMPLE_BALINESE, y: sampleY, size: balineseSizeMm },
    latin: latinLines.map((text, index) => ({ text, y: latinY + index * latinSizeMm * 1.2, size: latinSizeMm })),
    notes: [
      { text: isLayoutSample(project) ? "Sampel aksara tetap; bukan alih aksara nama usaha." : "Hasil layanan; masih memerlukan pemeriksaan bahasa.", y: height - marginMm - 16 },
      { text: getDraftNotice(project), y: height - marginMm },
    ],
  };
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]!));
}

export function validateSnapshot(project: ProjectDraft): string | null {
  if (!project.proposal || !project.confirmation || !project.transliteration || !project.render) return "Siapkan snapshot pratinjau sebelum ekspor.";
  if (project.confirmation.inputRevision !== project.input.inputRevision || project.proposal.inputRevision !== project.input.inputRevision || project.confirmation.proposalId !== project.proposal.proposalId || project.transliteration.confirmationId !== project.confirmation.confirmationId || project.render.inputRevision !== project.input.inputRevision || project.render.layoutRevision !== project.layout.layoutRevision || project.render.resultId !== project.transliteration.resultId || project.render.basedOnRevision !== project.revision) return "Pratinjau mengacu pada revisi sebelumnya. Perbarui pratinjau terlebih dahulu.";
  return validateSelections(project, project.confirmation.selections) ?? validateLayout(project.layout);
}

export function buildSvg(project: ProjectDraft, fonts?: { balinese: string; latin: string }): string {
  const error = validateSnapshot(project);
  if (error) throw new Error(error);
  if (fonts && ![fonts.balinese, fonts.latin].every((url) => /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(url))) throw new Error("Data font ekspor tidak valid.");
  const model = getBoardModel(project);
  const fontStyle = fonts ? `<style>@font-face{font-family:'Noto Sans Balinese';src:url('${fonts.balinese}')}@font-face{font-family:'IBM Plex Sans';src:url('${fonts.latin}')}</style>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}mm" height="${model.height}mm" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="Draf papan nama belum diperiksa ahli"><title>${escapeXml(project.input.latinName)} · ${isLayoutSample(project) ? "contoh tata letak" : "draf layanan"}</title><desc>${escapeXml(getBoardNotice(project))} ${escapeXml(getDraftNotice(project))}. Revisi ${project.revision}.</desc>${fontStyle}<rect width="100%" height="100%" fill="white"/><g fill="#171c19" text-anchor="${model.anchor}"><text x="${model.x}" y="${model.sample.y}" font-family="Noto Sans Balinese" font-size="${model.sample.size}">${escapeXml(model.sample.text)}</text>${model.latin.map((line) => `<text x="${model.x}" y="${line.y}" font-family="IBM Plex Sans, sans-serif" font-size="${line.size}">${escapeXml(line.text)}</text>`).join("")}</g><g fill="#59625c" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="13">${model.notes.map((note) => `<text x="${model.width / 2}" y="${note.y}">${escapeXml(note.text)}</text>`).join("")}</g></svg>`;
}

export function buildReviewPackage(project: ProjectDraft) {
  const error = validateSnapshot(project);
  if (error) throw new Error(error);
  return { documentType: "lembar_pemeriksaan_papan_nama", status: project.transliteration?.provenance.producer === "fixture" ? "data_contoh_belum_diperiksa_ahli" : "draf_belum_diperiksa_ahli", sampleNotice: getBoardNotice(project), printReadiness: "not_tested", project: structuredClone(project) };
}

export function consultationText(project: ProjectDraft): string {
  return `Mohon bantuan memeriksa draf papan nama ${project.input.latinName}.\nPelafalan pilihan: ${selectedPronunciations(project, project.confirmation?.selections ?? []).join(" ")}.\nUkuran draf: ${project.layout.boardMm.width} × ${project.layout.boardMm.height} mm.\n${getBoardNotice(project)}\nStatus: ${getDraftNotice(project)}. Mohon periksa pelafalan, hasil aksara asli, serta layout sebelum digunakan.`;
}

import { ServiceError, type ProjectDraft, type Proposal, type RenderResult } from "./contract.ts";
import { photoAnalysisSchema, type AuditFixtureScenario, type PhotoAnalysis } from "./photo-audit.ts";
import { buildReviewPackage, buildSvg, SAMPLE_BALINESE, validateInput, validateLayout, validateSelections } from "./project.ts";

type Scenario = "normal" | "loading" | "timeout" | "quota" | "fallback" | "layout_failed" | "export";
const auditSpecimen = { balinese: SAMPLE_BALINESE, latin: "WARUNG SARI" };

const provenance = { producer: "fixture" as const, delivery: "fixture" as const, providerId: null, modelVersion: null, artifactVersion: "ui-fixture-0.1", sourceRefs: [] };

async function simulate(scenario: Scenario, operation: "proposal" | "render" | "export") {
  if (scenario === "loading") await new Promise((resolve) => setTimeout(resolve, 3000));
  if (scenario === "timeout" && operation === "proposal") throw new ServiceError("AI_TIMEOUT", "Simulasi: usulan belum dapat dimuat. Inputmu tetap tersedia di sesi ini.");
  if (scenario === "quota" && operation === "proposal") throw new ServiceError("QUOTA_EXHAUSTED", "Simulasi: layanan AI tidak tersedia karena kuota habis.");
  if (scenario === "export" && operation === "export") throw new ServiceError("EXPORT_FAILED", "Simulasi: berkas belum berhasil dibuat. Pratinjau dan pilihanmu tetap tersedia.");
}

export function createFixtureProposal(project: ProjectDraft, fallback = false): Proposal {
  const error = validateInput(project.input);
  if (error) throw new ServiceError("INVALID_INPUT", error);
  return {
    proposalId: `fixture-proposal-${project.input.inputRevision}`,
    inputRevision: project.input.inputRevision,
    notationVersion: "fixture-only-0.1",
    tokens: (project.input.latinName.match(/\S+/gu) ?? []).map((original, index) => ({
      tokenId: `token-${index + 1}`, original, languageGuess: null,
      options: [
        { optionId: "as-written", pronunciation: original.toLocaleLowerCase("id"), reason: "Salinan teks untuk mencoba antarmuka; bukan usulan AI atau hasil penilaian bahasa." },
        ...(original.toLowerCase() === "sari" ? [{ optionId: "synthetic-alternative", pronunciation: "sāri", reason: "Alternatif sintetis untuk menguji pilihan; belum dinilai oleh ahli bahasa." }] : []),
      ],
      suggestedOptionId: null, requiresConfirmation: true,
    })),
    provenance,
    serviceState: fallback ? "quota_exhausted" : "not_called",
  };
}

async function fontDataUrl(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new ServiceError("EXPORT_FAILED", "Berkas font lokal belum dapat dimuat. Coba unduh lagi setelah font tersedia.");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ServiceError("EXPORT_FAILED", "Font belum dapat disisipkan ke berkas SVG."));
    reader.readAsDataURL(blob);
  });
}

export const fixtureService = {
  async suggestPronunciation(project: ProjectDraft, scenario: Scenario) {
    await simulate(scenario, "proposal");
    return createFixtureProposal(project, scenario === "fallback");
  },
  async renderBoard(project: ProjectDraft, scenario: Scenario): Promise<RenderResult> {
    await simulate(scenario, "render");
    const error = validateLayout(project.layout) ?? validateSelections(project, project.confirmation?.selections ?? []);
    if (error || !project.confirmation) throw new ServiceError("INVALID_INPUT", error ?? "Konfirmasi pelafalan terlebih dahulu.");
    const resultId = `fixture-sample-${project.revision}`;
    return {
      transliteration: { resultId, confirmationId: project.confirmation.confirmationId, balineseUnicode: SAMPLE_BALINESE, kind: "layout_sample", matchesInput: false, engineVersion: null, rulesVersion: null, sourceRefs: [], unsupportedTokenIds: project.proposal!.tokens.map((token) => token.tokenId), provenance },
      render: { renderId: `fixture-render-${project.revision}`, basedOnRevision: project.revision, inputRevision: project.input.inputRevision, resultId, layoutRevision: project.layout.layoutRevision },
      checks: {
        roundTrip: { status: "unavailable", note: "Mesin konversi dan mesin balik belum terhubung." },
        layout: scenario === "layout_failed"
          ? { status: "issues", findings: ["Simulasi: tulisan melewati margin papan."] }
          : { status: "not_run", findings: [] },
      },
    };
  },
  async createReviewPackage(project: ProjectDraft) {
    return { filename: "nyurat-paket-pemeriksaan-contoh.json", mimeType: "application/json", contents: JSON.stringify(buildReviewPackage(project), null, 2) };
  },
  async exportBoard(project: ProjectDraft, scenario: Scenario) {
    await simulate(scenario, "export");
    const [balinese, latin] = await Promise.all([fontDataUrl("/fonts/noto-sans-balinese-balinese-400-normal.woff2"), fontDataUrl("/fonts/ibm-plex-sans-latin-400-normal.woff2")]);
    return { filename: "nyurat-papan-contoh.svg", mimeType: "image/svg+xml", contents: buildSvg(project, { balinese, latin }) };
  },
};

export function createFixtureAudit(scenario: AuditFixtureScenario, photoRevision = 1): PhotoAnalysis {
  const detections: PhotoAnalysis["detections"] = [
    { id: "bali-1", script: "balinese", text: auditSpecimen.balinese, box: { x: .20, y: .20, width: .60, height: .25 }, uncertain: scenario === "uncertain" },
    { id: "latin-1", script: "latin", text: auditSpecimen.latin, box: { x: .20, y: .52, width: .60, height: .14 }, uncertain: false },
  ];
  return photoAnalysisSchema.parse({
    analysisId: `fixture-audit-${photoRevision}-${scenario}`, photoRevision,
    image: { width: 1200, height: 600 }, status: scenario === "no_detection" ? "no_detection" : scenario === "uncertain" ? "uncertain" : "detected",
    detections: scenario === "no_detection" ? [] : scenario === "missing_bali" ? detections.filter((item) => item.script === "latin") : detections,
    note: "Kotak dan teks berasal dari data contoh yang telah ditentukan, bukan pengenalan foto. Belum diperiksa ahli.",
    provenance: { ...provenance, artifactVersion: "photo-ui-fixture-0.1" },
  });
}


import "server-only";
import { renderResultSchema, type ProjectDraft, type RenderResult } from "../../lib/contract.ts";
import { selectedPronunciations, validateLayout, validateSelections, validateSnapshot } from "../../lib/project.ts";
import { checkRoundTrip } from "../aksara/reverse.ts";
import { transliterateName } from "../aksara/transliterate.ts";
import { ENGINE_VERSION, RULES_VERSION, SOURCE_REFS } from "../aksara/version.ts";
import { shortHash } from "../hash.ts";
import { ApiError } from "../http/errors.ts";

type Confirmed = ProjectDraft & { proposal: NonNullable<ProjectDraft["proposal"]>; confirmation: NonNullable<ProjectDraft["confirmation"]> };
type Computed = { transliteration: RenderResult["transliteration"]; roundTrip: RenderResult["checks"]["roundTrip"] };

function computeTransliteration(project: Confirmed): Computed {
  const pronunciations = selectedPronunciations(project, project.confirmation.selections);
  const { balineseUnicode, tokens } = transliterateName(pronunciations);
  // A name made only of symbols has nothing to write, and the schema refuses an empty result.
  if (!balineseUnicode) throw new ApiError("INVALID_INPUT", "Pelafalan terpilih tidak memuat huruf atau angka yang bisa ditulis dalam aksara Bali. Tulis pelafalannya sendiri lalu coba lagi.");

  const unsupportedTokenIds = project.proposal.tokens.flatMap((token, index) => tokens[index].supported ? [] : [token.tokenId]);
  return {
    transliteration: {
      resultId: `translit-${project.revision}-${shortHash(balineseUnicode + RULES_VERSION)}`,
      confirmationId: project.confirmation.confirmationId,
      balineseUnicode,
      kind: "transliteration",
      matchesInput: unsupportedTokenIds.length === 0,
      engineVersion: ENGINE_VERSION,
      rulesVersion: RULES_VERSION,
      sourceRefs: [...SOURCE_REFS],
      unsupportedTokenIds,
      provenance: { producer: "rules", delivery: "fresh", providerId: null, modelVersion: null, artifactVersion: ENGINE_VERSION, sourceRefs: [...SOURCE_REFS] },
    },
    roundTrip: checkRoundTrip(pronunciations, balineseUnicode),
  };
}

function assertConfirmed(project: ProjectDraft): asserts project is Confirmed {
  if (!project.confirmation) throw new ApiError("INVALID_INPUT", "Konfirmasi pelafalan terlebih dahulu.");
  if (!project.proposal) throw new ApiError("INVALID_INPUT", "Muat ulang usulan untuk nama terbaru.");
  const { confirmation, proposal, input } = project;
  if (confirmation.inputRevision !== input.inputRevision || proposal.inputRevision !== input.inputRevision || confirmation.proposalId !== proposal.proposalId) throw new ApiError("STALE_REVISION", "Konfirmasi mengacu pada usulan lama. Muat ulang usulan pelafalan.");
}

export function renderBoard(project: ProjectDraft): RenderResult {
  assertConfirmed(project);
  const invalid = validateSelections(project, project.confirmation.selections) ?? validateLayout(project.layout);
  if (invalid) throw new ApiError("INVALID_INPUT", invalid);

  const { transliteration, roundTrip } = computeTransliteration(project);
  const result = renderResultSchema.parse({
    transliteration,
    render: { renderId: `render-${project.revision}-${project.layout.layoutRevision}`, basedOnRevision: project.revision, inputRevision: project.input.inputRevision, resultId: transliteration.resultId, layoutRevision: project.layout.layoutRevision },
    checks: { roundTrip, layout: { status: "not_run", findings: [] } },
  });

  // The frontend runs this same check on the merged snapshot, so a failure here is a backend bug.
  const mismatch = validateSnapshot({ ...project, ...result });
  if (mismatch) throw new Error(`Snapshot hasil render tidak konsisten: ${mismatch}`);
  return result;
}

// Exports never trust client results: anything the engine can derive is replaced by what it derives.
// Only checks.layout survives, because the measurement exists only in the browser.
export function verifiedSnapshot(project: ProjectDraft): ProjectDraft {
  const invalid = validateSnapshot(project);
  if (invalid) throw new ApiError("STALE_REVISION", invalid);
  assertConfirmed(project);
  const { transliteration, roundTrip } = computeTransliteration(project);
  const sent = project.transliteration;
  if (sent?.balineseUnicode !== transliteration.balineseUnicode || sent.resultId !== transliteration.resultId) throw new ApiError("STALE_REVISION");
  return { ...project, transliteration, checks: { ...project.checks, roundTrip } };
}

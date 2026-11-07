import "server-only";
import { PROJECT_LIMITS, proposalSchema, type ProjectDraft, type Proposal, type Provenance } from "../../lib/contract.ts";
import { validateInput } from "../../lib/project.ts";
import { NOTATION_VERSION } from "../aksara/notation.ts";
import { SOURCE_REFS } from "../aksara/version.ts";
import { shortHash } from "../hash.ts";
import { ApiError } from "../http/errors.ts";
import { proposeWithGemini, type GeminiOutcome } from "./gemini-proposer.ts";
import { mergeOptions } from "./merge.ts";
import { proposeByRules, tokenize } from "./rules-proposer.ts";

const ARTIFACT_VERSION = "nyurat-proposals-0.1.0";

function provenanceFor(outcome: GeminiOutcome): Provenance {
  if (outcome.state === "available") return { producer: "ai", delivery: outcome.delivery, providerId: "google", modelVersion: outcome.model, artifactVersion: ARTIFACT_VERSION, sourceRefs: [] };
  return { producer: "rules", delivery: "fresh", providerId: null, modelVersion: null, artifactVersion: ARTIFACT_VERSION, sourceRefs: [...SOURCE_REFS] };
}

export async function buildProposal(project: ProjectDraft, requestId: string): Promise<Proposal> {
  const { input } = project;
  const invalid = validateInput(input);
  if (invalid) throw new ApiError("INVALID_INPUT", invalid);
  const words = tokenize(input.latinName);
  if (words.length > PROJECT_LIMITS.tokens) throw new ApiError("INVALID_INPUT", `Nama maksimal ${PROJECT_LIMITS.tokens} kata.`);

  const tokens = words.map((original, index) => ({ tokenId: `token-${index + 1}`, original }));
  const outcome = await proposeWithGemini({ tokens, input }, requestId);
  const suggestions = outcome.state === "available" ? outcome.suggestions : new Map();

  return proposalSchema.parse({
    proposalId: `proposal-${input.inputRevision}-${shortHash(JSON.stringify([input.latinName, input.businessType, input.sourceLanguage]))}`,
    inputRevision: input.inputRevision,
    notationVersion: NOTATION_VERSION,
    tokens: tokens.map(({ tokenId, original }) => {
      const suggestion = suggestions.get(tokenId);
      const { options, suggestedOptionId } = mergeOptions(proposeByRules(original), suggestion?.options ?? []);
      return { tokenId, original, languageGuess: suggestion?.languageGuess ?? null, options, suggestedOptionId, requiresConfirmation: true };
    }),
    provenance: provenanceFor(outcome),
    serviceState: outcome.state,
  });
}

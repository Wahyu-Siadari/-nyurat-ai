import { z } from "zod";

export const provenanceSchema = z.object({
  producer: z.enum(["fixture", "ai", "rules", "dictionary"]),
  delivery: z.enum(["fixture", "fresh", "cache"]),
  providerId: z.string().nullable(),
  modelVersion: z.string().nullable(),
  artifactVersion: z.string(),
  sourceRefs: z.array(z.string()),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const proposalSchema = z.object({
  proposalId: z.string().min(1),
  inputRevision: z.number().int().positive(),
  notationVersion: z.string().min(1),
  tokens: z.array(z.object({
    tokenId: z.string().min(1),
    original: z.string(),
    languageGuess: z.string().nullable(),
    options: z.array(z.object({ optionId: z.string(), pronunciation: z.string().min(1), reason: z.string() })).min(1),
    suggestedOptionId: z.string().nullable(),
    requiresConfirmation: z.boolean(),
  })).min(1).max(120),
  provenance: provenanceSchema,
  serviceState: z.enum(["not_called", "available", "quota_exhausted", "timeout", "unavailable"]),
});
export type Proposal = z.infer<typeof proposalSchema>;
export type Selection = { tokenId: string; kind: "option"; optionId: string } | { tokenId: string; kind: "custom"; pronunciation: string };
export type Input = { inputRevision: number; latinName: string; businessType: string | null; sourceLanguage: string | null };
export type Layout = {
  layoutRevision: number;
  boardMm: { width: number; height: number };
  marginMm: number;
  balineseSizeMm: number;
  latinSizeMm: number;
  alignment: "center" | "left";
  lineBreaks: "single" | "two_lines";
};

export const renderResultSchema = z.object({
  transliteration: z.object({
    resultId: z.string(), confirmationId: z.string(), balineseUnicode: z.string().min(1),
    kind: z.enum(["layout_sample", "transliteration"]), matchesInput: z.boolean(),
    engineVersion: z.string().nullable(), rulesVersion: z.string().nullable(),
    sourceRefs: z.array(z.string()), unsupportedTokenIds: z.array(z.string()), provenance: provenanceSchema,
  }),
  render: z.object({ renderId: z.string(), basedOnRevision: z.number().int(), inputRevision: z.number().int(), resultId: z.string(), layoutRevision: z.number().int() }),
  checks: z.object({
    roundTrip: z.object({ status: z.enum(["not_run", "unavailable", "pass", "mismatch", "error"]), note: z.string(), originalLatin: z.string().optional(), returnedLatin: z.string().optional() }),
    layout: z.object({ status: z.enum(["not_run", "pass", "issues", "error"]), findings: z.array(z.string()) }),
  }),
});
export type RenderResult = z.infer<typeof renderResultSchema>;
export const exportFileSchema = z.object({ filename: z.string().min(1), mimeType: z.string().min(1), contents: z.string().min(1) });
export type ExportFile = z.infer<typeof exportFileSchema>;
export type ProjectDraft = {
  schemaVersion: "0.1-draft";
  projectId: string;
  revision: number;
  mode: "new_board";
  input: Input;
  proposal: Proposal | null;
  confirmation: null | { confirmationId: string; proposalId: string; inputRevision: number; selections: Selection[]; confirmedAt: string };
  transliteration: RenderResult["transliteration"] | null;
  layout: Layout;
  render: RenderResult["render"] | null;
  checks: RenderResult["checks"];
  languageReview: { status: "unreviewed"; evidence: null };
  artifacts: Array<{ kind: "svg" | "pdf" | "review_sheet"; state: "ready"; basedOnRevision: number; validation: "not_tested" }>;
};

export interface NyuratService {
  suggestPronunciation(project: ProjectDraft): Promise<Proposal>;
  renderBoard(project: ProjectDraft): Promise<RenderResult>;
  createReviewPackage(project: ProjectDraft): Promise<ExportFile>;
  exportBoard(project: ProjectDraft): Promise<ExportFile>;
}

export class ServiceError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "ServiceError"; this.code = code; }
}

export const PROJECT_LIMITS = {
  nameChars: 120, pronunciationChars: 120, noteChars: 2000, labelChars: 64, idChars: 200,
  tokens: 120, optionsPerToken: 10, findings: 50, sourceRefs: 50, artifacts: 10,
} as const;

function countChars(text: string): number { return [...text].length; }
function limitedText(max: number) { return z.string().refine((text) => countChars(text) <= max, `Maksimal ${max} karakter.`); }
function withinNoteLimit(texts: string[]): boolean { return texts.every((text) => countChars(text) <= PROJECT_LIMITS.noteChars); }

const idSchema = z.string().min(1).refine((text) => countChars(text) <= PROJECT_LIMITS.idChars, `Maksimal ${PROJECT_LIMITS.idChars} karakter.`);
const revisionSchema = z.number().int().positive();
const selectionSchema = z.discriminatedUnion("kind", [
  z.object({ tokenId: idSchema, kind: z.literal("option"), optionId: idSchema }),
  z.object({ tokenId: idSchema, kind: z.literal("custom"), pronunciation: limitedText(PROJECT_LIMITS.pronunciationChars) }),
]);

// JSON.stringify turns the NaN of a cleared layout field into null. Restoring it lets validateLayout
// report the problem, and keeps an unfinished layout from blocking endpoints that never read it.
const layoutNumberSchema = z.number().nullable().transform((value) => value ?? Number.NaN);
const layoutSchema = z.object({
  layoutRevision: revisionSchema,
  boardMm: z.object({ width: layoutNumberSchema, height: layoutNumberSchema }),
  marginMm: layoutNumberSchema, balineseSizeMm: layoutNumberSchema, latinSizeMm: layoutNumberSchema,
  alignment: z.enum(["center", "left"]), lineBreaks: z.enum(["single", "two_lines"]),
});

const boundedProposalSchema = proposalSchema.refine((proposal) => proposal.provenance.sourceRefs.length <= PROJECT_LIMITS.sourceRefs && proposal.tokens.every((token) =>
  countChars(token.original) <= PROJECT_LIMITS.nameChars && token.options.length <= PROJECT_LIMITS.optionsPerToken &&
  token.options.every((option) => countChars(option.pronunciation) <= PROJECT_LIMITS.pronunciationChars && countChars(option.reason) <= PROJECT_LIMITS.noteChars)), "Usulan melewati batas ukuran.");
const boundedTransliterationSchema = renderResultSchema.shape.transliteration.refine((result) => result.unsupportedTokenIds.length <= PROJECT_LIMITS.tokens && result.sourceRefs.length <= PROJECT_LIMITS.sourceRefs && result.provenance.sourceRefs.length <= PROJECT_LIMITS.sourceRefs, "Hasil alih aksara melewati batas ukuran.");
const boundedChecksSchema = renderResultSchema.shape.checks.refine((checks) => checks.layout.findings.length <= PROJECT_LIMITS.findings && withinNoteLimit([checks.roundTrip.note, ...checks.layout.findings]), "Catatan pemeriksaan melewati batas ukuran.");

// Limits apply to data a client sends back; the schemas above stay the single source for responses.
export const projectDraftSchema = z.object({
  schemaVersion: z.literal("0.1-draft"),
  projectId: z.uuid(),
  revision: revisionSchema,
  mode: z.literal("new_board"),
  input: z.object({
    inputRevision: revisionSchema,
    latinName: limitedText(PROJECT_LIMITS.nameChars),
    businessType: limitedText(PROJECT_LIMITS.labelChars).nullable(),
    sourceLanguage: limitedText(PROJECT_LIMITS.labelChars).nullable(),
  }),
  proposal: boundedProposalSchema.nullable(),
  confirmation: z.object({
    confirmationId: idSchema, proposalId: idSchema, inputRevision: revisionSchema,
    selections: z.array(selectionSchema).max(PROJECT_LIMITS.tokens),
    confirmedAt: limitedText(PROJECT_LIMITS.labelChars),
  }).nullable(),
  transliteration: boundedTransliterationSchema.nullable(),
  layout: layoutSchema,
  render: renderResultSchema.shape.render.nullable(),
  checks: boundedChecksSchema,
  languageReview: z.object({ status: z.literal("unreviewed"), evidence: z.null() }),
  artifacts: z.array(z.object({ kind: z.enum(["svg", "pdf", "review_sheet"]), state: z.literal("ready"), basedOnRevision: z.number().int(), validation: z.literal("not_tested") })).max(PROJECT_LIMITS.artifacts),
}) satisfies z.ZodType<ProjectDraft, unknown>;

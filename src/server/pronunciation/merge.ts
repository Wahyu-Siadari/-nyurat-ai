import "server-only";
import { isPhoneticNotation, isValidNotation, normalizeNotation } from "../aksara/notation.ts";
import type { ProposedOption } from "./rules-proposer.ts";

export const MAX_OPTIONS_PER_TOKEN = 5;

type MergedOption = ProposedOption & { optionId: string };
export type MergedToken = { options: MergedOption[]; suggestedOptionId: string | null };

function normalizeOptions(options: ProposedOption[], isValid: (notation: string) => boolean): ProposedOption[] {
  return options.map((option) => ({ ...option, pronunciation: normalizeNotation(option.pronunciation) })).filter((option) => isValid(option.pronunciation));
}

// Order: the as-written rule option, then AI options, then remaining rule options. A rule option that
// repeats an AI option moves up with it, so the suggested option can never be cut by the limit.
export function mergeOptions(ruleOptions: ProposedOption[], aiOptions: ProposedOption[]): MergedToken {
  const rules = normalizeOptions(ruleOptions, isValidNotation).map((option, index) => ({ ...option, optionId: `rules-${index + 1}` }));
  const ordered = new Map<string, MergedOption>();
  const add = (option: MergedOption) => { if (!ordered.has(option.pronunciation)) ordered.set(option.pronunciation, option); };

  if (rules[0]) add(rules[0]);
  let suggestedOptionId: string | null = null;
  let aiCount = 0;
  for (const option of normalizeOptions(aiOptions, isPhoneticNotation)) {
    const existing = ordered.get(option.pronunciation) ?? rules.find((rule) => rule.pronunciation === option.pronunciation);
    if (!existing) aiCount += 1;
    const merged = existing ?? { ...option, optionId: `ai-${aiCount}` };
    add(merged);
    suggestedOptionId ??= merged.optionId;
  }
  rules.forEach(add);
  return { options: [...ordered.values()].slice(0, MAX_OPTIONS_PER_TOKEN), suggestedOptionId };
}

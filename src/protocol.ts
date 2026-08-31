export const MAX_PLAN_CHARS = 12_000;
export const MAX_QUESTION_CHARS = 4_000;
export const MAX_WIRE_CHARS = 64_000;

export interface ParsedReply {
  answer: string;
  plan?: string;
  suggestConclusion: boolean;
}

export interface ConclusionValidation {
  valid: boolean;
  missing: string[];
}

const PLAN_BLOCK = /\n?<SOKRATES_PLAN>\s*([\s\S]*?)\s*<\/SOKRATES_PLAN>\s*/i;
const SUGGEST_CONCLUSION = /\n?<SOKRATES_SUGGEST_CONCLUSION\s*\/>\s*/gi;
const CONCLUSION_SECTIONS = [
  "Decisions",
  "Rejected alternatives",
  "Unresolved questions",
  "Revised plan",
  "Validation and handoff",
] as const;
const HANDOFF_CHECKS = ["scope", "constraints", "acceptance criteria", "tests", "rollback"] as const;
const CONCLUSION_HEADING_PATTERN = CONCLUSION_SECTIONS.join("|");

export function compactText(value: string, limit: number): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, limit);
}

export function parseReply(text: string): ParsedReply {
  const suggestConclusion = SUGGEST_CONCLUSION.test(text);
  SUGGEST_CONCLUSION.lastIndex = 0;
  const withoutSuggestion = text.replace(SUGGEST_CONCLUSION, "\n");
  const match = PLAN_BLOCK.exec(withoutSuggestion);
  if (!match) return { answer: withoutSuggestion.trim(), suggestConclusion };
  const plan = compactText(match[1] ?? "", MAX_PLAN_CHARS);
  return {
    answer: withoutSuggestion.replace(PLAN_BLOCK, "\n").trim(),
    ...(plan ? { plan } : {}),
    suggestConclusion,
  };
}

export function materialPlanKey(plan: string): string {
  return compactText(plan, MAX_PLAN_CHARS)
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
}

export function shouldSuggestConclusion(plan: string, lastSuggestedPlanKey?: string): boolean {
  const key = materialPlanKey(plan);
  return Boolean(key) && key !== lastSuggestedPlanKey;
}

function conclusionSection(text: string, section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^#{1,6}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s+(?:${CONCLUSION_HEADING_PATTERN})\\s*$|(?![\\s\\S]))`,
    "im",
  ).exec(text)?.[1]?.trim() ?? "";
}

export function validateConclusion(text: string, plan?: string): ConclusionValidation {
  const missing: string[] = [];
  for (const section of CONCLUSION_SECTIONS) {
    if (!conclusionSection(text, section)) missing.push(section);
  }

  const validation = conclusionSection(text, "Validation and handoff").toLocaleLowerCase("en-US");
  for (const check of HANDOFF_CHECKS) {
    if (!validation.includes(check)) missing.push(`validation: ${check}`);
  }
  if (!plan) {
    missing.push("complete <SOKRATES_PLAN> replacement");
  } else if (!materialPlanKey(conclusionSection(text, "Revised plan")).includes(materialPlanKey(plan))) {
    missing.push("revised plan matches replacement");
  }
  return { valid: missing.length === 0, missing };
}

export function sparringPrompt(plan: string, question: string): string {
  return `[SOKRATES]\nPlanning debate only. Do not call tools or implement. Answer directly in <=120 words. Challenge assumptions when useful. Keep the replacement plan complete: preserve decisions and rejected alternatives, and make unresolved questions explicit.\n\nCurrent plan:\n${compactText(plan, MAX_PLAN_CHARS)}\n\nUser:\n${compactText(question, MAX_QUESTION_CHARS)}\n\nIf and only if the plan changes, append the complete replacement inside <SOKRATES_PLAN>...</SOKRATES_PLAN>. Keep it compact. If the plan is coherent, risks are addressed, and unresolved questions are explicit, you may append <SOKRATES_SUGGEST_CONCLUSION/>. This only suggests the manual Conclude debate action; never conclude automatically.`;
}

export function conclusionPrompt(plan: string): string {
  return `[SOKRATES CONCLUDE]\nThe user manually chose Conclude debate. Do not call tools or implement. Produce a self-contained handoff in Markdown with exactly these headings:\n## Decisions\n## Rejected alternatives\n## Unresolved questions\n## Revised plan\n## Validation and handoff\n\nRetain prior decisions and rejected options. Under Validation and handoff explicitly verify scope, constraints, acceptance criteria, tests, and rollback; mark missing information as unresolved rather than inventing it. Include the complete revised plan under Revised plan, then append that same complete plan inside <SOKRATES_PLAN>...</SOKRATES_PLAN>. Do not emit <SOKRATES_SUGGEST_CONCLUSION/>.\n\nCurrent plan:\n${compactText(plan, MAX_PLAN_CHARS)}`;
}

export function encodeMessage(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

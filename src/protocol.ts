export const MAX_PLAN_CHARS = 12_000;
export const MAX_QUESTION_CHARS = 4_000;
export const MAX_WIRE_CHARS = 64_000;

export interface ParsedReply {
  answer: string;
  plan?: string;
}

const PLAN_BLOCK = /\n?<SOKRATES_PLAN>\s*([\s\S]*?)\s*<\/SOKRATES_PLAN>\s*/i;

export function compactText(value: string, limit: number): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, limit);
}

export function parseReply(text: string): ParsedReply {
  const match = PLAN_BLOCK.exec(text);
  if (!match) return { answer: text.trim() };
  const plan = compactText(match[1] ?? "", MAX_PLAN_CHARS);
  return {
    answer: text.replace(PLAN_BLOCK, "\n").trim(),
    ...(plan ? { plan } : {}),
  };
}

export function sparringPrompt(plan: string, question: string): string {
  return `[SOKRATES]\nPlanning debate only. Do not call tools or implement. Answer directly in <=120 words. Challenge assumptions when useful.\n\nCurrent plan:\n${compactText(plan, MAX_PLAN_CHARS)}\n\nUser:\n${compactText(question, MAX_QUESTION_CHARS)}\n\nIf and only if the plan changes, append the complete replacement inside <SOKRATES_PLAN>...</SOKRATES_PLAN>. Keep it compact.`;
}

export function encodeMessage(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

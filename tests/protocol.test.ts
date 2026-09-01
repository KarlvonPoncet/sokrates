import assert from "node:assert/strict";
import test from "node:test";
import {
  compactText,
  conclusionPrompt,
  materialPlanKey,
  parseReply,
  shouldSuggestConclusion,
  sparringPrompt,
  validateConclusion,
} from "../src/protocol.js";

test("parseReply separates a replacement plan", () => {
  assert.deepEqual(
    parseReply("Risk: race.\n<SOKRATES_PLAN>\n1. Lock\n2. Write\n</SOKRATES_PLAN>"),
    { answer: "Risk: race.", plan: "1. Lock\n2. Write", suggestConclusion: false },
  );
});

test("parseReply leaves ordinary answers intact", () => {
  assert.deepEqual(parseReply("  Looks sound.  "), { answer: "Looks sound.", suggestConclusion: false });
});

test("prompt is compact and bounded", () => {
  const prompt = sparringPrompt("p".repeat(20_000), "q".repeat(10_000));
  assert.match(prompt, /Planning debate only/);
  assert.ok(prompt.length < 17_000);
});

test("compactText normalizes line endings", () => {
  assert.equal(compactText(" a\r\nb\r ", 20), "a\nb");
});

test("parseReply extracts a manual conclusion suggestion", () => {
  assert.deepEqual(
    parseReply("Ready when you are.\n<SOKRATES_SUGGEST_CONCLUSION/>"),
    { answer: "Ready when you are.", suggestConclusion: true },
  );
});

test("conclusion plans appear once in the handoff", () => {
  const reply = parseReply([
    "## Revised plan",
    "<SOKRATES_CONCLUSION_PLAN># Plan\n- Implement once</SOKRATES_CONCLUSION_PLAN>",
    "## Validation and handoff",
    "Checked.",
  ].join("\n\n"));
  assert.equal(reply.plan, "# Plan\n- Implement once");
  assert.match(reply.answer, /## Revised plan[\s\S]*# Plan/);
  assert.doesNotMatch(reply.answer, /SOKRATES_CONCLUSION_PLAN/);
});

test("conclusion suggestions are suppressed until plan content changes", () => {
  const plan = "# Plan\n- Add tests";
  const key = materialPlanKey(plan);
  assert.equal(shouldSuggestConclusion(plan), true);
  assert.equal(shouldSuggestConclusion(" # Plan\n\n * Add tests ", key), false);
  assert.equal(shouldSuggestConclusion("# Plan\n- Add rollback tests", key), true);
});

test("conclusion validation requires every handoff section and a complete plan", () => {
  const complete = [
    "## Decisions",
    "Use a command.",
    "## Rejected alternatives",
    "Automatic completion.",
    "## Unresolved questions",
    "None.",
    "## Revised plan",
    "Implement and test.",
    "## Validation and handoff",
    "Scope, constraints, acceptance criteria, tests, and rollback checked.",
  ].join("\n\n");
  assert.deepEqual(validateConclusion(complete, "Implement and test."), { valid: true, missing: [] });
  assert.equal(validateConclusion("## Decisions\nUse a command.").valid, false);
  assert.ok(validateConclusion(complete.replace("and rollback", "only"), "Implement and test.").missing.includes("validation: rollback"));
  assert.ok(validateConclusion(complete, "A different plan.").missing.includes("revised plan matches replacement"));
  assert.equal(validateConclusion(complete.replace("Implement and test.", "# Goal\n\nImplement and test."), "# Goal\n\nImplement and test.").valid, true);
});

test("conclusion prompt keeps conclusion manual and validates handoff concerns", () => {
  const prompt = conclusionPrompt("Implement the action.");
  assert.match(prompt, /manually chose Conclude debate/);
  assert.match(prompt, /scope, constraints, acceptance criteria, tests, and rollback/);
  assert.match(prompt, /Rejected alternatives/);
});

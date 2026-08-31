import assert from "node:assert/strict";
import test from "node:test";
import { compactText, parseReply, sparringPrompt } from "../src/protocol.js";

test("parseReply separates a replacement plan", () => {
  assert.deepEqual(
    parseReply("Risk: race.\n<SOKRATES_PLAN>\n1. Lock\n2. Write\n</SOKRATES_PLAN>"),
    { answer: "Risk: race.", plan: "1. Lock\n2. Write" },
  );
});

test("parseReply leaves ordinary answers intact", () => {
  assert.deepEqual(parseReply("  Looks sound.  "), { answer: "Looks sound." });
});

test("prompt is compact and bounded", () => {
  const prompt = sparringPrompt("p".repeat(20_000), "q".repeat(10_000));
  assert.match(prompt, /Planning debate only/);
  assert.ok(prompt.length < 17_000);
});

test("compactText normalizes line endings", () => {
  assert.equal(compactText(" a\r\nb\r ", 20), "a\nb");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { streamLines } from "./helpers.mjs";
import { createCollector, evaluate, finalText } from "../plugins/pi/scripts/lib/stream.mjs";

function collect(text, chunk = Infinity) {
  const collector = createCollector();
  const buffer = Buffer.from(text, "utf8");
  for (let offset = 0; offset < buffer.length; offset += chunk) collector.push(buffer.subarray(offset, offset + chunk));
  collector.end();
  return collector.state;
}

test("a clean run yields usage, model, thinking, text and ok", () => {
  const state = collect(streamLines({ text: "Report ✓" }));
  assert.deepEqual(state.usage, {
    turns: 1,
    input: 1000,
    output: 200,
    cacheRead: 9000,
    cacheWrite: 100,
    cost: 0.1234,
    contextTokens: 12000,
  });
  assert.equal(state.model, "openai-codex/gpt-6-astra");
  assert.equal(state.thinking, "high");
  assert.equal(finalText(state), "Report ✓");
  assert.deepEqual(evaluate(state, { exitCode: 0, stderr: "" }), { ok: true });
});

test("chunked CRLF input with no trailing newline parses like the clean stream", () => {
  const crlf = streamLines({ text: "Report ✓" }).replace(/\n/g, "\r\n").replace(/\r\n$/, "");
  const state = collect(crlf, 7);
  assert.equal(state.malformed, 0);
  assert.equal(finalText(state), "Report ✓");
  assert.equal(state.settled, true);
});

test("two assistant turns accumulate; context is the last total", () => {
  const first = streamLines({
    text: "a",
    usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { total: 0.01 } },
  });
  const second = streamLines({
    text: "b",
    usage: { input: 200, output: 20, cacheRead: 50, cacheWrite: 5, totalTokens: 385, cost: { total: 0.02 } },
  });
  const state = collect(first + second);
  assert.equal(state.usage.turns, 2);
  assert.equal(state.usage.input, 300);
  assert.equal(state.usage.contextTokens, 385);
  assert.ok(Math.abs(state.usage.cost - 0.03) < 1e-9);
  assert.equal(finalText(state), "b");
});

test("failures are classified with the most specific reason first", () => {
  const errored = collect(streamLines({ text: "partial", stopReason: "error", errorMessage: "429 rate limited" }));
  assert.deepEqual(evaluate(errored, { exitCode: 0, stderr: "" }), { ok: false, reason: "429 rate limited" });
  assert.equal(finalText(errored), "partial");

  const unsettled = collect(streamLines({ settled: false }));
  assert.deepEqual(evaluate(unsettled, { exitCode: 0, stderr: "" }), {
    ok: false,
    reason: "pi exited without settling",
  });

  const nonzero = collect(streamLines());
  assert.deepEqual(evaluate(nonzero, { exitCode: 3, stderr: "Error: no auth\n" }), {
    ok: false,
    reason: "Error: no auth",
  });
  assert.deepEqual(evaluate(nonzero, { exitCode: 3, stderr: "" }), { ok: false, reason: "exit 3" });

  const empty = collect("");
  assert.deepEqual(evaluate(empty, { exitCode: 0, stderr: "" }), {
    ok: false,
    reason: "no completed assistant response",
  });

  const killed = collect(streamLines());
  assert.deepEqual(evaluate(killed, { exitCode: null, stderr: "", signal: "SIGTERM" }), {
    ok: false,
    reason: "aborted (SIGTERM)",
  });

  const lines = streamLines().split("\n");
  lines.splice(2, 0, "{not json");
  const malformed = collect(lines.join("\n"));
  assert.equal(malformed.malformed, 1);
  assert.equal(finalText(malformed), "done");
  assert.deepEqual(evaluate(malformed, { exitCode: 0, stderr: "" }), {
    ok: false,
    reason: "1 malformed JSON record(s) in pi output",
  });

  const erroredLines = streamLines({ stopReason: "error", errorMessage: "429 rate limited" }).split("\n");
  erroredLines.splice(2, 0, "{not json");
  const both = collect(erroredLines.join("\n"));
  assert.deepEqual(evaluate(both, { exitCode: 0, stderr: "" }), {
    ok: false,
    reason: "429 rate limited; 1 malformed JSON record(s) in pi output",
  });
});

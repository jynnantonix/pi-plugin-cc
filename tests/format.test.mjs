import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTokens, formatUsage } from "../plugins/pi/scripts/lib/format.mjs";

test("formatTokens uses the pi example's k/M short forms", () => {
  const cases = [
    [0, "0"],
    [999, "999"],
    [1000, "1.0k"],
    [3400, "3.4k"],
    [9999, "10.0k"],
    [10000, "10k"],
    [48321, "48k"],
    [999999, "1000k"],
    [1000000, "1.0M"],
    [1250000, "1.3M"],
  ];
  for (const [count, expected] of cases) assert.equal(formatTokens(count), expected, `count ${count}`);
});

test("formatUsage prints turns, arrows, cache ratio, context and cost", () => {
  const full = {
    turns: 7,
    input: 48000,
    output: 3400,
    cacheRead: 120000,
    cacheWrite: 2100,
    contextTokens: 62000,
    cost: 0.4249,
  };
  assert.equal(formatUsage(full), "7 turns ↑48k ↓3.4k R120k W2.1k cache 71% ctx 62k $0.42");
  const bare = { turns: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0 };
  assert.equal(formatUsage(bare), "1 turn");
  const noCache = { turns: 2, input: 500, output: 10, cacheRead: 0, cacheWrite: 0, contextTokens: 510, cost: 0.004 };
  assert.equal(formatUsage(noCache), "2 turns ↑500 ↓10 cache 0% ctx 510 $0.00");
});

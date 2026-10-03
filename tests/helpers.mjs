import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolvePiPackageDir } from "../plugins/pi/scripts/lib/pi.mjs";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCRIPT = join(REPO, "plugins", "pi", "scripts", "pi-subagent.mjs");
export const FAKE_PI = join(REPO, "tests", "fixtures", "fake-pi.mjs");
/** The real pi package: PI_SUBAGENT_PI points at the fake, whose location says nothing about the package. */
export const PI_PACKAGE = resolvePiPackageDir(process.env);

export function tempDir(prefix = "pi-plugin-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeAgent(
  agentDir,
  name,
  { frontmatter = `name: ${name}\ndescription: test agent\n`, body = `You are ${name}.` } = {},
) {
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  const file = join(agentDir, "agents", `${name}.md`);
  writeFileSync(file, `---\n${frontmatter}---\n${body}\n`);
  return file;
}

/** The script's env: ours plus `env`, without an inherited PI_SUBAGENT (the suite may itself run inside pi). */
export function childEnv(env = {}) {
  const merged = { ...process.env, PI_SUBAGENT_PACKAGE: PI_PACKAGE, ...env };
  if (!("PI_SUBAGENT" in env)) delete merged.PI_SUBAGENT;
  return merged;
}

export function runScript(args, { cwd, env = {}, input } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: childEnv(env),
  });
}

/** A pi --mode json run as JSONL text. Shapes follow docs/json.md and a recorded 1.0.0 session. */
export function streamLines({
  text = "done",
  provider = "openai-codex",
  model = "gpt-6-astra",
  stopReason = "stop",
  errorMessage,
  usage = {},
  settled = true,
  thinkingLevel = "high",
  cwd = "/tmp",
} = {}) {
  const u = {
    input: 1000,
    output: 200,
    cacheRead: 9000,
    cacheWrite: 100,
    totalTokens: 12000,
    cost: { total: 0.1234 },
    ...usage,
  };
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text }],
    provider,
    model,
    thinkingLevel,
    usage: u,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 1791022400000,
  };
  const events = [
    { type: "session", version: 3, id: "fixture", timestamp: "2026-10-03T00:00:00.000Z", cwd },
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_end", message: { role: "user", content: "Task: x", timestamp: 1791022399000 } },
    { type: "message_update", usage: u, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } },
    { type: "message_end", message: assistant },
    { type: "turn_end", message: assistant, toolResults: [] },
    { type: "agent_end", messages: [assistant], willRetry: false },
  ];
  if (settled) events.push({ type: "agent_settled" });
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

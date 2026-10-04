#!/usr/bin/env node
// Stand-in for `pi --mode json -p`. Records argv, appends a plausible session file, replays a stream.
// Knobs: FAKE_PI_ARGV (record path), FAKE_PI_FIXTURE (stream file), FAKE_PI_ANSWER_MODEL (provider/id),
// FAKE_PI_EXIT, FAKE_PI_STDERR, FAKE_PI_MODE=hang|exit, FAKE_PI_NO_SESSION=1.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { streamLines } from "../helpers.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
if (process.env.FAKE_PI_MODE === "exit") {
  process.stderr.write("early exit\n");
  process.exit(3);
}
let task = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) task += chunk;
const record = { argv, task, cwd: process.cwd(), piSubagent: process.env.PI_SUBAGENT ?? null };
const promptFile = flag("--append-system-prompt");
if (promptFile) record.prompt = readFileSync(promptFile, "utf8");
if (process.env.FAKE_PI_ARGV) writeFileSync(process.env.FAKE_PI_ARGV, JSON.stringify(record));

const sessionFile = flag("--session");
const existed = existsSync(sessionFile) && statSync(sessionFile).size > 0;
const requested = flag("--model") ?? "openai-codex/gpt-6-astra";
const answered = process.env.FAKE_PI_ANSWER_MODEL ?? requested;
const [provider, model] = answered.split("/");
const now = new Date().toISOString();
// Like pi, persist the header and model before any model work, so a killed run stays resumable.
if (!process.env.FAKE_PI_NO_SESSION && !existed) {
  appendFileSync(
    sessionFile,
    `${JSON.stringify({ type: "session", version: 3, id: `fake-${Date.now()}`, timestamp: now, cwd: process.cwd() })}\n` +
      `${JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: now, provider, modelId: model })}\n`,
  );
}

if (process.env.FAKE_PI_MODE === "hang") {
  process.on("SIGTERM", () => process.exit(143));
  setTimeout(() => {}, 60000);
} else {
  if (!process.env.FAKE_PI_NO_SESSION) {
    appendFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", id: `u${Date.now()}`, parentId: "m1", timestamp: now, message: { role: "user", content: task, timestamp: Date.now() } })}\n`,
    );
  }
  const stream = process.env.FAKE_PI_FIXTURE
    ? readFileSync(process.env.FAKE_PI_FIXTURE, "utf8")
    : streamLines({ text: existed ? "resumed ok" : "new ok", provider, model, cwd: process.cwd() });
  process.stdout.write(stream);
  if (process.env.FAKE_PI_STDERR) process.stderr.write(process.env.FAKE_PI_STDERR);
  process.exitCode = Number(process.env.FAKE_PI_EXIT ?? 0);
}

#!/usr/bin/env node
// Start or resume a pi conversation and print a header plus the final assistant text.
// Spec: docs/superpowers/specs/2026-10-03-pi-claude-plugin-design.md
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "./lib/errors.mjs";
import { importPi, resolvePiBinary } from "./lib/pi.mjs";
import { allocateId, loadAgent, parseId } from "./lib/agents.mjs";
import { acquireLock } from "./lib/lock.mjs";
import { readSessionInfo } from "./lib/session.mjs";
import { buildArgs, runChild, writePrompt } from "./lib/run.mjs";
import { evaluate, finalText } from "./lib/stream.mjs";
import { renderHeader, renderJson } from "./lib/render.mjs";

const BARE_MODEL = (source) =>
  `${source} must be <provider/id>; pi fuzzy-matches bare names, which defeats the mismatch check`;
const SUFFIXED_MODEL = (source) => `${source} must be <provider/id> without a :thinking suffix; use --thinking`;
const USAGE = `Usage:
  pi-subagent.mjs start  --agent <name> --task-file <path|-> [--cwd <dir>] [--model <provider/id>] [--thinking <level>] [--approve] [--json]
  pi-subagent.mjs resume --id <public-id> --task-file <path|-> [--approve] [--json]`;

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        agent: { type: "string" },
        id: { type: "string" },
        "task-file": { type: "string" },
        cwd: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string" },
        approve: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(`${error.message}\n${USAGE}`);
  }
  const [verb, ...rest] = parsed.positionals;
  if (rest.length) throw new UsageError(`unexpected argument: ${rest[0]}\n${USAGE}`);
  if (verb !== "start" && verb !== "resume") throw new UsageError(USAGE);
  return { verb, values: parsed.values };
}

function readBrief(taskFile) {
  if (!taskFile) throw new UsageError("--task-file is required");
  let text;
  try {
    text = readFileSync(taskFile === "-" ? 0 : taskFile, "utf8");
  } catch {
    throw new UsageError(`cannot read task file ${taskFile}`);
  }
  if (!text.trim()) throw new UsageError("task file is empty");
  return text;
}

/** A model must be exactly <provider/id>: bare names and :thinking suffixes defeat the mismatch check. */
function checkModel(model, source) {
  if (!model.includes("/")) throw new UsageError(BARE_MODEL(source));
  if (model.includes(":")) throw new UsageError(SUFFIXED_MODEL(source));
}

async function main(argv) {
  if (process.env.PI_SUBAGENT === "1") {
    throw new UsageError("nested pi subagents are not allowed: this process is already a pi subagent (PI_SUBAGENT=1)");
  }
  const { verb, values } = parse(argv);
  const binary = resolvePiBinary();
  const task = readBrief(values["task-file"]);
  const { getAgentDir } = await importPi();
  const agentDir = getAgentDir();
  // Absolute, so pi (spawned in --cwd) and this process name the same session file.
  const root = resolve(process.env.PI_SUBAGENT_ROOT || join(agentDir, "claude-subagent-sessions"));

  let id;
  let dir;
  let agent;
  let cwd;
  let requestedModel = null;
  let model;
  let thinking;
  let run;
  let cwdNote = null;

  if (verb === "start") {
    if (!values.agent) throw new UsageError("--agent is required for start");
    if (values.id) throw new UsageError("--id is not accepted by start");
    agent = await loadAgent(values.agent, agentDir);
    cwd = resolve(values.cwd ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new UsageError(`--cwd is not a directory: ${cwd}`);
    if (values.model !== undefined) checkModel(values.model, "--model");
    else if (agent.model !== undefined) checkModel(agent.model, `${agent.filePath}: model`);
    model = values.model ?? agent.model;
    thinking = values.thinking;
    requestedModel = model ?? null;
    run = "new";
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (;;) {
      id = allocateId(agent.name);
      dir = join(root, id);
      try {
        mkdirSync(dir, { mode: 0o700 });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
  } else {
    if (!values.id) throw new UsageError("--id is required for resume");
    for (const flag of ["agent", "cwd", "model", "thinking"]) {
      if (values[flag] !== undefined)
        throw new UsageError(`--${flag} is not accepted by resume; the session restores it`);
    }
    id = values.id;
    const { agent: agentName } = parseId(id);
    dir = join(root, id);
    const sessionFile = join(dir, "session.jsonl");
    if (!existsSync(sessionFile)) throw new UsageError(`unknown id "${id}": ${sessionFile} not found`);
    const info = readSessionInfo(sessionFile);
    agent = await loadAgent(agentName, agentDir);
    cwd = info.cwd;
    requestedModel = info.model;
    run = "resumed";
    if (!existsSync(cwd)) throw new UsageError(`session cwd no longer exists: ${cwd}`);
    if (cwd !== process.cwd()) cwdNote = `session cwd differs from current directory ${process.cwd()}`;
  }

  const sessionFile = join(dir, "session.jsonl");
  const lock = acquireLock(dir);
  let prompt;
  let outcome;
  try {
    prompt = writePrompt(agent.systemPrompt);
    const args = buildArgs({
      sessionFile,
      promptFile: prompt.file,
      tools: agent.tools,
      model: run === "new" ? model : undefined,
      thinking: run === "new" ? thinking : undefined,
      approve: values.approve,
    });
    outcome = await runChild({ binary, args, cwd, task });
  } finally {
    lock.release();
    try {
      prompt?.cleanup();
    } catch (error) {
      // A leftover temp prompt must not change the run's result; say so on our own stderr.
      process.stderr.write(`pi-subagent: warning: cannot remove temp prompt: ${error.message}\n`);
    }
    if (run === "new" && !existsSync(sessionFile)) rmSync(dir, { recursive: true, force: true });
  }

  const { state, exitCode, signal, stderr } = outcome;
  const verdict = evaluate(state, { exitCode, stderr, signal });
  const result = {
    id,
    status: verdict.ok ? "ok" : `error: ${verdict.reason}`,
    run,
    model: state.model,
    thinking: state.thinking ?? (run === "new" ? (thinking ?? null) : null),
    cwd,
    requestedModel,
    modelMismatch:
      requestedModel && state.model && requestedModel !== state.model
        ? `requested ${requestedModel}, answered ${state.model}`
        : null,
    cwdNote,
    usage: state.usage,
    text: finalText(state),
    stderr: stderr.trim(),
  };
  process.stdout.write(values.json ? renderJson(result) : renderHeader(result));
  return verdict.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`pi-subagent: ${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);

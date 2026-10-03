import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollector } from "./stream.mjs";

/** Spec §4 Launch: fixed order, prompt file always present, overrides only when given. */
export function buildArgs({ sessionFile, promptFile, tools, model, thinking, approve, task }) {
  const args = ["--mode", "json", "-p", "--session", sessionFile, "--append-system-prompt", promptFile];
  if (tools?.length) args.push("--tools", tools.join(","));
  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);
  if (approve) args.push("--approve");
  args.push(`Task: ${task}`);
  return args;
}

export function writePrompt(systemPrompt) {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagent-"));
  const file = join(dir, "prompt.md");
  writeFileSync(file, systemPrompt, { mode: 0o600 });
  return {
    file,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Spawn pi, stream stdout into the collector, forward SIGTERM/SIGINT, escalate to SIGKILL after 5 s. */
export async function runChild({ binary, args, cwd, lock, env = process.env }) {
  const collector = createCollector();
  let stderr = "";
  const child = spawn(binary, args, { cwd, env: { ...env, PI_SUBAGENT: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  if (child.pid) lock.update(child.pid);
  child.stdout.on("data", (chunk) => collector.push(chunk));
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  let killTimer;
  let aborted = null; // the signal we forwarded, so a child that exits 143 on SIGTERM still reads as aborted
  const terminate = (signal) => {
    aborted = signal;
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
    killTimer.unref();
  };
  process.on("SIGTERM", terminate);
  process.on("SIGINT", terminate);
  try {
    const exit = await new Promise((resolve) => {
      child.once("error", (error) => {
        stderr += `${error.message}\n`;
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    collector.end();
    const signal = exit.signal ?? aborted;
    return { state: collector.state, exitCode: exit.code ?? (signal ? null : 1), signal, stderr };
  } finally {
    process.off("SIGTERM", terminate);
    process.off("SIGINT", terminate);
    if (killTimer) clearTimeout(killTimer);
  }
}

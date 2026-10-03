import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { FAKE_PI, SCRIPT, runScript, streamLines, tempDir, writeAgent } from "./helpers.mjs";

function setup() {
  const base = tempDir();
  const agentDir = join(base, "agent");
  const root = join(base, "root");
  const work = join(base, "work");
  mkdirSync(work);
  writeAgent(agentDir, "reviewer", {
    frontmatter: "name: reviewer\ndescription: Reviews\nmodel: openai-codex/gpt-6-astra\ntools: read, bash\n",
    body: "Review only.",
  });
  const brief = join(base, "brief.md");
  writeFileSync(brief, "Review the change.\n");
  const argvFile = join(base, "argv.json");
  const env = {
    PI_CODING_AGENT_DIR: agentDir,
    PI_SUBAGENT_ROOT: root,
    PI_SUBAGENT_PI: FAKE_PI,
    FAKE_PI_ARGV: argvFile,
  };
  const argv = () => JSON.parse(readFileSync(argvFile, "utf8"));
  const header = (stdout) =>
    Object.fromEntries(
      stdout
        .split("\n\n")[0]
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
    );
  return { base, agentDir, root, work, brief, env, argv, header };
}

test("start launches pi with the spec's argv, persists a session and cleans up", () => {
  const t = setup();
  const result = runScript(["start", "--agent", "reviewer", "--task-file", t.brief, "--cwd", t.work], {
    cwd: t.base,
    env: t.env,
  });
  assert.equal(result.status, 0, result.stderr);
  const h = t.header(result.stdout);
  assert.match(h.id, /^reviewer-[0-9a-f]{8}$/);
  assert.equal(h.status, "ok");
  assert.equal(h.run, "new");
  assert.equal(h.model, "openai-codex/gpt-6-astra");
  assert.equal(h.thinking, "high");
  assert.equal(h.cwd, t.work);
  assert.equal(h.usage, "1 turn ↑1.0k ↓200 R9.0k W100 cache 90% ctx 12k $0.12");
  assert.ok(result.stdout.endsWith("\n\nnew ok\n"));
  assert.equal("model-mismatch" in h, false);

  const dir = join(t.root, h.id);
  const sessionFile = join(dir, "session.jsonl");
  const recorded = t.argv();
  const promptFile = recorded.argv[recorded.argv.indexOf("--append-system-prompt") + 1];
  assert.deepEqual(recorded.argv, [
    "--mode",
    "json",
    "-p",
    "--session",
    sessionFile,
    "--append-system-prompt",
    promptFile,
    "--tools",
    "read,bash",
    "--model",
    "openai-codex/gpt-6-astra",
    "Task: Review the change.\n",
  ]);
  assert.equal(recorded.prompt, "Review only.");
  assert.equal(recorded.cwd, t.work);
  assert.equal(recorded.piSubagent, "1");
  assert.equal(existsSync(promptFile), false, "temp prompt removed");
  assert.deepEqual(readdirSync(dir), ["session.jsonl"], "no lock after exit");
  assert.equal(JSON.parse(readFileSync(sessionFile, "utf8").split("\n")[0]).type, "session");

  // A relative root resolves against this process's cwd, not pi's --cwd, so the session survives.
  const relative = runScript(["start", "--agent", "reviewer", "--task-file", t.brief, "--cwd", t.work], {
    cwd: t.base,
    env: { ...t.env, PI_SUBAGENT_ROOT: "rel-root" },
  });
  assert.equal(relative.status, 0, relative.stderr);
  assert.ok(existsSync(join(t.base, "rel-root", t.header(relative.stdout).id, "session.jsonl")));
});

test("resume reuses the session, re-passes the role, and refuses overrides and unknown IDs", () => {
  const t = setup();
  const first = runScript(["start", "--agent", "reviewer", "--task-file", t.brief, "--cwd", t.work], {
    cwd: t.base,
    env: t.env,
  });
  const id = t.header(first.stdout).id;
  writeFileSync(t.brief, "Recheck finding R1.\n");

  const second = runScript(["resume", "--id", id, "--task-file", t.brief], { cwd: t.base, env: t.env });
  assert.equal(second.status, 0, second.stderr);
  const h = t.header(second.stdout);
  assert.equal(h.id, id);
  assert.equal(h.run, "resumed");
  assert.equal(h.cwd, t.work, "cwd comes from the session header");
  assert.equal(h["cwd-note"], `session cwd differs from current directory ${t.base}`);
  assert.ok(second.stdout.endsWith("\n\nresumed ok\n"));
  const recorded = t.argv();
  assert.equal(recorded.cwd, t.work);
  assert.equal(recorded.argv.includes("--model"), false);
  assert.equal(recorded.argv.includes("--thinking"), false);
  assert.deepEqual(recorded.argv.slice(7, 9), ["--tools", "read,bash"]);
  assert.equal(recorded.prompt, "Review only.");

  const override = runScript(["resume", "--id", id, "--task-file", t.brief, "--model", "x/y"], {
    cwd: t.base,
    env: t.env,
  });
  assert.equal(override.status, 2);
  assert.match(override.stderr, /--model is not accepted by resume/);

  const unknown = runScript(["resume", "--id", "reviewer-00000000", "--task-file", t.brief], {
    cwd: t.base,
    env: t.env,
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown id "reviewer-00000000"/);

  const emptyDir = join(t.root, "reviewer-11111111");
  mkdirSync(emptyDir);
  writeFileSync(join(emptyDir, "session.jsonl"), "");
  const empty = runScript(["resume", "--id", "reviewer-11111111", "--task-file", t.brief], { cwd: t.base, env: t.env });
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /no session header; start a new conversation/);

  writeFileSync(join(t.root, id, "lock"), `${process.pid}\n`);
  const busy = runScript(["resume", "--id", id, "--task-file", t.brief], { cwd: t.base, env: t.env });
  assert.equal(busy.status, 2);
  assert.match(busy.stderr, new RegExp(`busy \\(pid ${process.pid}\\)`));
});

test("failures: non-zero exit keeps partial text, mismatch is reported, no-session dirs are removed", () => {
  const t = setup();
  const fixture = join(t.base, "partial.jsonl");
  writeFileSync(fixture, streamLines({ text: "half a report", settled: false }));
  const failed = runScript(["start", "--agent", "reviewer", "--task-file", t.brief], {
    cwd: t.work,
    env: { ...t.env, FAKE_PI_FIXTURE: fixture, FAKE_PI_EXIT: "3", FAKE_PI_STDERR: "Error: boom\n" },
  });
  assert.equal(failed.status, 1);
  assert.equal(t.header(failed.stdout).status, "error: Error: boom");
  assert.ok(failed.stdout.endsWith("\n\nhalf a report\n"));
  assert.equal(readdirSync(t.root).length, 1, "failed run with a session file is kept");

  const mismatch = runScript(
    ["start", "--agent", "reviewer", "--task-file", t.brief, "--model", "openai-codex/gpt-6-sol"],
    {
      cwd: t.work,
      env: { ...t.env, FAKE_PI_ANSWER_MODEL: "openai-codex/gpt-6-astra" },
    },
  );
  assert.equal(mismatch.status, 0);
  assert.equal(
    t.header(mismatch.stdout)["model-mismatch"],
    "requested openai-codex/gpt-6-sol, answered openai-codex/gpt-6-astra",
  );

  const before = readdirSync(t.root).length;
  const noSession = runScript(["start", "--agent", "reviewer", "--task-file", t.brief], {
    cwd: t.work,
    env: { ...t.env, FAKE_PI_NO_SESSION: "1", FAKE_PI_EXIT: "1" },
  });
  assert.equal(noSession.status, 1);
  assert.equal(readdirSync(t.root).length, before, "a run that persisted nothing leaves no directory");

  const json = runScript(["start", "--agent", "reviewer", "--task-file", t.brief, "--json"], {
    cwd: t.work,
    env: t.env,
  });
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.usage.input, 1000);
  assert.equal(parsed.text, "new ok");
  assert.equal(parsed.requestedModel, "openai-codex/gpt-6-astra");
});

test("refusals happen before any file is written", () => {
  const t = setup();
  const big = join(t.base, "big.md");
  writeFileSync(big, "x".repeat(100001));
  const oversized = runScript(["start", "--agent", "reviewer", "--task-file", big], { cwd: t.work, env: t.env });
  assert.equal(oversized.status, 2);
  assert.match(oversized.stderr, /exceeds 100000 bytes/);

  const noPi = runScript(["start", "--agent", "reviewer", "--task-file", t.brief], {
    cwd: t.work,
    env: { ...t.env, PI_SUBAGENT_PI: "", PATH: "/nonexistent" },
  });
  assert.equal(noPi.status, 2);
  assert.match(noPi.stderr, /pi not found on PATH/);

  const bogus = runScript(["start", "--agent", "reviewer", "--task-file", t.brief, "--bogus"], {
    cwd: t.work,
    env: t.env,
  });
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /bogus/);
  const noVerb = runScript([], { cwd: t.work, env: t.env });
  assert.equal(noVerb.status, 2);
  assert.match(noVerb.stderr, /Usage:/);
  const empty = join(t.base, "empty.md");
  writeFileSync(empty, "  \n");
  assert.equal(
    runScript(["start", "--agent", "reviewer", "--task-file", empty], { cwd: t.work, env: t.env }).status,
    2,
  );
  const bare = runScript(["start", "--agent", "reviewer", "--task-file", t.brief, "--model", "sonnet"], {
    cwd: t.work,
    env: t.env,
  });
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /provider\/id/);
  assert.equal(existsSync(t.root), false, "nothing created under the root");

  writeFileSync(t.brief, "@secret.txt --flag first\n");
  const prefixed = runScript(["start", "--agent", "reviewer", "--task-file", "-"], {
    cwd: t.work,
    env: t.env,
    input: "@secret.txt --flag first\n",
  });
  assert.equal(prefixed.status, 0, prefixed.stderr);
  assert.equal(t.argv().argv.at(-1), "Task: @secret.txt --flag first\n");
});

test("SIGTERM forwards to pi, releases the lock and reports aborted", async () => {
  const t = setup();
  const child = spawn(process.execPath, [SCRIPT, "start", "--agent", "reviewer", "--task-file", t.brief], {
    cwd: t.work,
    env: { ...process.env, ...t.env, FAKE_PI_MODE: "hang" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  const deadline = Date.now() + 10000;
  let dir;
  while (Date.now() < deadline) {
    const entries = existsSync(t.root) ? readdirSync(t.root) : [];
    if (
      entries.length &&
      existsSync(join(t.root, entries[0], "lock")) &&
      existsSync(join(t.root, entries[0], "session.jsonl"))
    ) {
      dir = join(t.root, entries[0]);
      break;
    }
    await sleep(50);
  }
  assert.ok(dir, "lock and session file appeared");
  child.kill("SIGTERM");
  const code = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(code, 1);
  // The fake persisted its header before hanging, so the directory must survive with only the session file:
  // this proves the lock was released, not that the directory was swept.
  assert.deepEqual(readdirSync(dir), ["session.jsonl"]);
  assert.equal(JSON.parse(readFileSync(join(dir, "session.jsonl"), "utf8").split("\n")[0]).type, "session");
  assert.equal(t.header(stdout).status, "error: aborted (SIGTERM)");
});

# Pi subagents from Claude Code

Status: Implemented; simplified contract approved 2026-10-04.

## Purpose and boundary

Claude Code starts pi as a subprocess for a delegated task and resumes the same
conversation for follow-ups. The plugin supplies the mechanism, not role or
model policy. The calling workflow chooses the agent and checks the returned
model and status.

Use Claude Code's background Bash jobs and completion notifications for long
runs. The plugin has no scheduler, job table, progress service, status/cancel
commands, MCP server or forwarding model. Node launches pi directly.

## Layout and dependencies

- `plugins/pi/scripts/pi-subagent.mjs`: `start` and `resume` entry point.
- `plugins/pi/scripts/lib/`: role loading, process execution, session metadata,
  exclusive locking, JSONL collection and result formatting.
- `plugins/pi/skills/pi-subagent/SKILL.md`: the command contract.
- `.claude-plugin/marketplace.json`: local marketplace; plugin manifest under
  `plugins/pi/.claude-plugin/`.
- `tests/`: Node tests and a fake pi; no provider calls.

The runtime uses Node and the installed pi package. Resolve pi from PATH and
follow the npm binary symlink to its package to import `parseFrontmatter` and
`getAgentDir`. `PI_SUBAGENT_PACKAGE` overrides the package directory for shell
shims. `PI_SUBAGENT_PI` overrides the executable for testing. There are no
separate runtime npm dependencies or build step.

## Commands

```text
pi-subagent.mjs start --agent <name> --task-file <path|->
                     [--cwd <dir>] [--model <provider/id>] [--thinking <level>]
                     [--approve] [--json]
pi-subagent.mjs resume --id <public-id> --task-file <path|-> [--approve] [--json]
```

- Agents are `<agent-dir>/agents/<name>.md`, where `<agent-dir>` is
  `PI_CODING_AGENT_DIR` or `~/.pi/agent`. Only user-scoped definitions are read.
  Names match `^[a-z0-9][a-z0-9-]*$`.
- Frontmatter requires matching `name` and nonempty `description`; optional
  `model` and `tools` (comma string or string list). Other frontmatter values
  must be plain scalars. The body supplies the appended system prompt.
- `--task-file -` reads the caller's stdin. An empty task is refused. The brief
  is sent intact through the child's stdin, never as a process argument. There
  is no command-line byte limit; model context limits still apply.
- New conversations use the specified cwd or the caller's cwd. Resume uses the
  cwd from the saved session header and reports any difference from the caller.
- New conversations use the model override, then the role model, then pi's
  default. Models must use `provider/id` with no thinking suffix. Bare names
  and suffixed names are refused. Thinking has its own optional flag.
- Resume rejects agent, cwd, model and thinking overrides. Pi restores model,
  thinking and history; the current role file supplies prompt and tools again.
  A missing role file refuses the run.
- `--approve` grants project trust for this launch only. Otherwise pi's saved
  trust decision applies. Non-interactive pi cannot prompt for project trust.

## Identity and storage

IDs are `<agent>-<8 lowercase hex>`, with a cryptographically random suffix.
The agent name is recovered from the ID on resume. Each conversation has:

```text
<agent-dir>/claude-subagent-sessions/<id>/
  session.jsonl
  lock
```

`PI_SUBAGENT_ROOT` can override the root. Resolve it to an absolute path before
changing cwd. Directories are created with mode `0700`. Pi owns the native
session file; there is no snapshot, index or result sidecar.

A new run that exits without a session file removes its empty conversation
directory. Persisted conversations are never automatically deleted. Open them
with `pi --session <path>` or export with `pi --export <path>`.

## Locking and recovery

Exclusively create `lock` before launching pi. The file contains the launcher
PID for diagnosis only. Every existing lock refuses a run, including an empty
file or one naming a dead process. There is no stale-PID detection, PID handoff,
lock replacement, reclaim mutex or automatic crash recovery.

After pi closes, release the lock once. Repeated release must not delete a
later holder's lock. Independent IDs do not contend.

A crash or SIGKILL can leave the marker and a running pi child. Before manually
removing the named lock, verify that both the launcher and any pi process using
that session file have stopped. Never infer that the child stopped merely from
a dead launcher PID. Do not remove active locks or edit an active conversation
through pi's TUI.

This trades automatic recovery for a small, fail-closed mechanism. Locking
coordinates this wrapper's invocations, not external session-file writers.

## Process lifecycle

Launch pi with `--mode json -p --session <absolute file>` and
`--append-system-prompt <temporary file>`, plus the selected tools and optional
model, thinking and trust flags. Close stdin after writing the brief. Consume
stdout and stderr continuously and wait for process close.

- The environment includes `PI_SUBAGENT=1`. The wrapper refuses to start when
  that marker is already set, preventing nesting through this plugin.
- The temporary role prompt is mode `0600` and removed after the run.
- SIGTERM/SIGINT forwards SIGTERM to pi, then SIGKILL after five seconds if
  needed. Wait for close before releasing the lock. SIGKILL of the wrapper
  cannot perform cleanup.
- A child that exits before reading stdin must report its own failure rather
  than crash the wrapper with an unhandled broken-pipe error. A failed stdin
  delivery must not be reported as successful completion.

## Result contract

Consume JSONL on LF boundaries with a UTF-8 decoder. Record completed assistant
messages, usage, model, thinking, stop reason, and `agent_start`/`agent_settled`.
Do not retain streaming deltas or tool events in a second event store.

Stdout is a header, blank line, then the last assistant message's text:

```text
id: reviewer-3f9a1c2e
status: ok
run: new
model: openai-codex/gpt-6-astra
thinking: high
cwd: /path/to/project
usage: 7 turns ↑48k ↓3.4k R120k W2.1k cache 71% ctx 62k $0.42
```

`run` is `new` or `resumed`. `status` is `ok` or `error: <reason>`. Partial text
is retained on failure. `cwd-note` reports a restored cwd different from the
caller's. `model` is the model that answered; `model-mismatch` reports a
requested/restored model different from the answer. The calling skill must
stop on a mismatch, even if the process otherwise completed successfully.

Pi can fuzzy-match a partial model ID and can fall back when a saved model is
unavailable. This wrapper reports that after the run; it does not enforce an
exact-model preflight. The saved expected model is read from the file-latest
`model_change`; after a TUI branch change this can differ from pi's branch-latest
model and produce a false mismatch.

Usage sums completed assistant turns, input/output/cache tokens and cost. Context
tokens come from the last nonzero total. Token counts use pi's `k`/`M` forms;
cache ratio is `cacheRead / (input + cacheRead)`.

`--json` returns raw numbers and the fields `id`, `status`, `run`, `model`,
`thinking`, `cwd`, `requestedModel`, `modelMismatch`, `cwdNote`, `usage`, `text`
and `stderr` in one object.

Exit codes:

- `0`: pi exited zero, completed an assistant message, settled, and returned
  neither an error nor aborted stop reason; no malformed JSON records.
- `1`: execution or internal failure. Internal failures can have only stderr;
  failures after pi runs normally include the result header.
- `2`: refused before spawn, with the reason on stderr and no result header.

## Verification

`npm run check` runs formatting, syntax checks and Node tests. Tests cover role
validation, IDs, stream/error handling, usage, exclusive locking, refusal of
existing locks, idempotent release, start/resume, overrides, large stdin briefs,
early child exit and cancellation. Fake pi consumes stdin and persists a native
session-shaped fixture; tests make no provider requests.

The README's manual acceptance checks real start/resume and retained context.
It costs provider usage and is separate from the automated gate. The installed
plugin must be refreshed after changing the source checkout; source tests do
not prove the cached plugin was updated.

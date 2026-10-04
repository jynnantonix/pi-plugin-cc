---
name: pi-subagent
description: Use when a task must run in a pi conversation started from an agent definition, or when a follow-up must go back to an existing pi conversation by its public ID.
---

# pi subagent

This plugin starts and resumes pi conversations. It does not choose agents, models or roles.
That policy comes from the skill or repository instructions that sent you here.

## Agents

An agent is a Markdown file `<agent-dir>/agents/<name>.md`. `<agent-dir>` is `PI_CODING_AGENT_DIR`
or `~/.pi/agent`. Frontmatter: `name` (equal to the file name), `description`, optional `model`
(`provider/id`), optional `tools` (comma list). The body is the agent's system prompt.

## Commands

Write the task to a file first. Then run one of:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-subagent.mjs" start --agent <name> --task-file <path> [--cwd <dir>] [--model <provider/id>] [--thinking <level>] [--approve]
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-subagent.mjs" resume --id <public-id> --task-file <path> [--approve]
```

- `start` creates a new conversation. The role's `model` is the default; `--model` and `--thinking`
  override it for this conversation. A model must be spelled `provider/id`, with the exact id as
  `pi --list-models` prints it and no `:thinking` suffix. A bare name or a suffix is refused, because
  pi would fuzzy-match it and the mismatch check below could not tell. Pi still matches a partial
  id by substring, so a partial id produces a `model-mismatch` line rather than a refusal.
- `resume` continues a conversation. It takes the ID and a task file and nothing else. The session
  restores model, thinking level and history; the role file supplies the prompt and tools again.
- `--approve` grants pi project trust for this run only. Use it only on a checkout whose trust has
  not been saved.

Run through the `Bash` tool with `run_in_background: true` by default. A review or implementation
run can exceed the ten-minute foreground limit. Use the foreground only when the task is expected
to be short.

## Reading the result

Stdout is a header, a blank line, then the final assistant text verbatim:

```
id: reviewer-3f9a1c2e
status: ok
run: new
model: openai-codex/gpt-6-astra
thinking: high
cwd: /srv/code/predator
usage: 7 turns ↑48k ↓3.4k R120k W2.1k cache 71% ctx 62k $0.42
```

- Keep `id`. It is the handle for every follow-up.
- `status` is `ok` or `error: <reason>`. Partial text is still printed after an error.
- `model` names the model that answered. A `model-mismatch:` line means pi fell back from the
  requested or restored model; stop and report it.
- `cwd-note:` on a resume means the session's working directory differs from yours; the session's
  directory was used.
- After every run, repeat `id`, `status`, `model` and `usage` to the user. Bash output is collapsed
  in their view.

Exit codes: `0` completed; `1` the run failed (header present when pi ran; an internal failure such
as an unwritable temp directory exits `1` with only a stderr line); `2` refused before spawn, with
the reason on stderr and no header. A refusal changes nothing on disk.

## Rules

- One run per ID at a time. An existing `lock` file refuses the run and names the path.
  The file contains the launcher PID for diagnosis; it is never reclaimed automatically.
  After a crash or SIGKILL, verify that both the launcher and any pi process using that
  session file have stopped, then remove only the named lock file manually. A dead launcher
  alone does not prove that its child stopped. Never remove a lock for an active run
  or edit its session through pi's TUI.
- Different IDs run in parallel freely. Start as many background runs as the work needs.
- A pi child cannot start another subagent: the script refuses to run when `PI_SUBAGENT=1` is in
  its environment, which every child inherits.
- A cancel (SIGTERM or SIGINT to the script) forwards SIGTERM to pi, SIGKILL after five seconds,
  waits for pi to close, releases the lock and reports an aborted status. Whatever pi
  persisted stays resumable. SIGKILL cannot run cleanup and leaves the lock for manual recovery.
- Never pass `--agent`, `--cwd`, `--model` or `--thinking` to `resume`.
- The brief is sent through pi's stdin, not its process arguments. There is no command-line
  size cap; model context limits still apply. Reference long supporting material by path.
- Conversations live under `<agent-dir>/claude-subagent-sessions/<id>/session.jsonl`. Open one in
  pi's own interface with `pi --session <that path>`, or export it with `pi --export <that path>`.
  A `start` whose pi never wrote a session file leaves no directory behind.
- If `pi` on `PATH` is a shell shim rather than the npm symlink, set `PI_SUBAGENT_PACKAGE` to the
  `@earendil-works/pi-coding-agent` directory so the script can import pi's frontmatter parser.

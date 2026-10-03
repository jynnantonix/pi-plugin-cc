# Pi subagents from Claude Code

Date: 2026-10-03
Status: Draft for user review
Repository: `/srv/code/pi-plugin-cc` (new)
Also changes: `/srv/code/chezmoi` (global skills and agents), `/srv/code/predator`
(workflow policy)

## 1. Purpose

Claude Code becomes the only controller. Pi runs only as a subagent process that
Claude Code starts, resumes and reads. This removes the second harness: its
adapters, its `/skill:review-plan` entry point, its preflight procedure and its
copy of the role table.

The plugin provides a mechanism, not a policy. It starts a pi conversation from
an agent definition, resumes an existing conversation by a stable public ID, and
reports what happened. Which agent plays which role, at which model, is stated
by the `execute-plan` and `review-plan` skills and by each repository's workflow
policy, not by the plugin.

Decisions taken in conversation on 2026-10-03:

- Serve any agent definition in pi's agent directory. The first users are the
  SDD roles (`implementer`, `reviewer`, `plan-reviewer`) and the general
  `worker`, but the plugin names none of them.
- Keep persistence and resume. Drop `pi-subagent`'s frozen launch snapshot, its
  `--offline` requirement and its exact-catalog preflight. Pi's own session file
  carries model, thinking level and history; the plugin keeps only the session
  directory and the public ID.
- Long runs go through Claude Code's `Bash` tool with `run_in_background`,
  which is the default. Foreground only when a task is expected to be short. No
  job table, status or cancel commands inside the plugin.
- `--model` and `--thinking` overrides are accepted for any agent on a new
  conversation and rejected on resume.
- The work covers the plugin and the policy rewrite. A live progress display is
  deferred to a later spec.
- Token counts use the pi example's `k`/`M` short forms, not full precision.
- Base the runtime on pi's own subagent example (`examples/extensions/subagent`
  in the installed `@earendil-works/pi-coding-agent`), importing its helpers
  from the installed pi package. Take from `pi-subagent` only two ideas: a public
  ID that names a persistent session file, and a lock while a child runs.

## 2. Facts the design relies on

Verified against the installed pi 1.0.0 (`dist/core/sdk.js`,
`dist/core/session-manager.js`, `dist/main.js`) and a real session file.

- A session file begins with a `session` header holding `id` and `cwd`, then a
  `model_change` entry and a `thinking_level_change` entry. On reopen,
  `createAgentSession` restores the latest `model_change` on the branch unless
  `--model` is given, and the thinking level unless `--thinking` is given. If
  the saved model is missing or has no credentials, pi falls back to its default
  model and prints a warning; it does not fail.
- The role prompt (`--append-system-prompt`, stored as the `addendum` section)
  and the tool set are rebuilt from flags and settings on every launch. A resume
  must pass them again.
- `--session <arg>`: an argument containing `/` is treated as a path and opened
  directly, with no project lookup and no fork prompt. A missing file is created
  at that path with the current working directory; an existing file supplies cwd
  from its header. `--session-dir` is unnecessary when a path is given.
- Print, JSON and RPC modes cannot show the project-trust prompt. Without
  `--approve` or `--no-approve`, the saved decision in `trust.json` applies;
  with none saved, protected project resources are skipped.
- Claude Code's `Bash` tool caps a foreground command at ten minutes.
  `run_in_background` runs the command detached and re-invokes the model when
  it exits. Each background call is independent.
- The Claude Code function-hooks module API (panes, bands, status line) is
  documented in the bundled `plugin-authoring` skill and marked early access:
  "this surface may change between releases without notice."

## 3. Architecture

A Claude Code plugin named `pi` in a new repository, `pi-plugin-cc`, with a
local marketplace so it installs by path.

```
pi-plugin-cc/
  .claude-plugin/marketplace.json
  plugins/pi/
    .claude-plugin/plugin.json
    scripts/pi-subagent.mjs          entry: start | resume
    scripts/lib/*.mjs                agents, launch, stream, lock, format
    skills/pi-subagent/SKILL.md      the mechanism contract Claude reads
  tests/*.test.mjs
  package.json                       test and check scripts only
  docs/superpowers/specs/            this document
```

Two components:

1. **Runtime** `scripts/pi-subagent.mjs`: plain Node 22 ESM, no build step, no
   npm dependencies. It resolves the installed pi package from the `pi` binary
   on `PATH` (realpath of `pi` is `<package>/dist/bundle/cli.js`; the package's
   `"."` export is `dist/index.js`) and imports `parseFrontmatter`,
   `getAgentDir` and `CONFIG_DIR_NAME` from it, as the example does. This keeps
   the library version equal to the binary it spawns. `PI_SUBAGENT_PI` overrides
   the binary path for tests.
2. **Skill** `skills/pi-subagent/SKILL.md`: the only place the controller learns
   the contract. Section 6 lists its content.

Not in the plugin: a forwarding Claude agent, a job table, an MCP server, slash
commands, a Stop-hook review gate, and any agent names.

Claude invokes the runtime through its `Bash` tool:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-subagent.mjs" start --agent reviewer --task-file <brief>
```

The shell is one line deep: it launches `node`, which runs the script, which
spawns `pi`. `Bash` is used because it is the Claude Code tool that offers
`run_in_background` and a completion notice.

Rejected alternatives: a thin Claude forwarding agent as in the codex plugin
(an extra model hop with nothing gained, since background runs through `Bash`,
not `Agent`); an MCP server (a tool call blocks the controller for the whole
run); building on the function-hooks module API (early access).

## 4. Runtime contract

### Verbs

```
pi-subagent.mjs start  --agent <name> --task-file <path|-> [--cwd <dir>]
                       [--model <provider/id>] [--thinking <level>] [--approve] [--json]
pi-subagent.mjs resume --id <public-id> --task-file <path|-> [--approve] [--json]
```

- `--agent <name>`: a Markdown file `<agent-dir>/agents/<name>.md` with
  frontmatter `name`, `description`, optional `model`, optional `tools` (comma
  string or list), and the system prompt as body. `<agent-dir>` is
  `getAgentDir()`, which honours `PI_CODING_AGENT_DIR` and defaults to
  `~/.pi/agent`. Names must match `^[a-z0-9][a-z0-9-]*$`. Frontmatter values
  other than plain scalars (or a list for `tools`) are rejected. Project-scoped
  agents (`.pi/agents`) are not consulted in v1.
- `--task-file`: the brief. `-` reads stdin. The contents become pi's prompt
  argument, prefixed `Task: `, as in both pi extensions. An empty brief is
  rejected.
- `--cwd`: the child's working directory for a new conversation; default is the
  current directory. On resume the session header's cwd is used, and a
  difference from the current directory is reported in the header.
- `--model`, `--thinking`: forwarded verbatim to pi's flags of the same name.
  With no `--model`, the role's `model` is forwarded if present; otherwise pi's
  default applies. Both are rejected on `resume`.
- `--approve`: forwards pi's one-time trust override. Default is no flag.
- `--json`: emit one JSON object instead of the text form (see Output).

### Public ID and storage

A public ID is `<agent>-<8 lowercase hex>`, allocated from `crypto` on `start`.
Because the agent name is a constrained token and the suffix has fixed width,
the agent name parses back from the ID. `resume` uses it to re-read the role
file and pass its prompt and tools again. If the role file is gone, resume
fails and names the file; it never runs the session without its prompt.

Storage root: `<agent-dir>/claude-subagent-sessions/`, overridable by
`PI_SUBAGENT_ROOT`. Per conversation:

```
<root>/<public-id>/
  session.jsonl     pi's native history, passed as --session
  lock              present only while a child runs; holds the child PID
```

Nothing else: no snapshot, no index, no result or event files. Directories are
created `0700`. The root is distinct from `pi-subagent`'s `subagent-sessions`
so the two layouts are never confused.

### Lock

`lock` is created with the `wx` flag (atomic create) and holds the PID of the
pi child once known. A live PID refuses the run with
`status: error: busy (pid <n>)`. A dead PID is treated as stale: the file is
removed and the run proceeds. The lock is per conversation; independent
conversations run in parallel without coordination. The plugin imposes no
concurrency cap; the controller decides how many children to run.

### Launch

```
pi --mode json -p
   --session <root>/<id>/session.jsonl
   --append-system-prompt <tempfile>
   [--tools <role tools>]
   [--model <provider/id>] [--thinking <level>]      new conversations only
   [--approve]
   "Task: <brief>"
```

- cwd is `--cwd` (new) or the session header's cwd (resume).
- Environment is the parent's plus `PI_SUBAGENT=1`, so the child's installed
  `subagent` extension stays unregistered and children cannot nest.
- The prompt temp file is mode `0600` and removed after exit.
- stdin is ignored; stdout is consumed as a JSONL stream split on LF with a UTF-8
  decoder, never Node `readline`; stderr is captured.

### Stream consumption

As in the example: `message_end` messages are collected; each assistant message
adds to turns, input, output, cacheRead, cacheWrite and cost, sets context
tokens from its `totalTokens`, and records provider/model, stop reason and
error message. `agent_start` and `agent_settled` are tracked. Streaming deltas
and tool-execution events are not retained. The final assistant text is the
concatenated text blocks of the last assistant message.

### Output

Text form: a header of `key: value` lines, a blank line, then the final
assistant text verbatim. Partial text is printed even on failure.

```
id: reviewer-3f9a1c2e
status: ok
run: new
model: openai-codex/gpt-6-astra
thinking: high
cwd: /srv/code/predator
usage: 7 turns ↑48k ↓3.4k R120k W2.1k cache 91% ctx 62k $0.42

<final assistant text>
```

- `status` is `ok` or `error: <reason>`.
- `run` is `new` or `resumed`.
- `model` is the model that answered (from the assistant message), not the one
  requested. When it differs from the requested or restored model, an extra line
  `model-mismatch: requested <x>, answered <y>` follows.
- `usage` uses the example's `formatTokens`: below 1000 as-is, below 10k one
  decimal plus `k`, below 1M rounded `k`, else one decimal plus `M`. Cache ratio
  is `cacheRead / (input + cacheRead)` as a percentage; cost to two decimals.
- `--json` emits `{ id, status, run, model, thinking, cwd, requestedModel,
  usage: { turns, input, output, cacheRead, cacheWrite, contextTokens, cost },
  text, stderr }` with raw numbers.

### Exit codes

- `0`: pi exited 0, an assistant message completed, `agent_settled` arrived,
  and the stop reason was neither `error` nor `aborted`.
- `1`: the run started and failed (section 5).
- `2`: refused before spawn; the session file was not touched.

## 5. Error handling

Before spawn, exit 2:

- Unknown `--agent`, or a role file with non-scalar frontmatter.
- Malformed `--id`, or an ID whose directory or `session.jsonl` does not exist.
  Resume never creates.
- Role file missing for a resumed ID.
- Lock held by a live PID.
- `--model` or `--thinking` on `resume`.
- Missing task file or empty brief.

During the run, exit 1, with the reason in `status`:

- pi exits non-zero, or exits 0 without a completed assistant message or
  without `agent_settled`: reason is trimmed stderr, or `exit <code>`.
- Stop reason `error` or `aborted`: reason is the message's `errorMessage`.
- A malformed JSONL line is reported in the reason but the remaining lines are
  still consumed, so the final text is not lost over one bad record.

Signals: SIGTERM or SIGINT to the script forwards SIGTERM to pi, escalates to
SIGKILL after five seconds, waits for close, then releases the lock. A Claude
Code cancel of the background job lands here. Whatever pi persisted before the
kill stays resumable.

Reported but not errors: `model-mismatch`, and a resumed run whose header cwd
differs from the current directory.

## 6. The skill

`skills/pi-subagent/SKILL.md` states only the mechanism:

- Agents are Markdown files in `<agent-dir>/agents` with `name`,
  `description`, optional `model` and `tools`. The plugin names none.
- The two verbs, their flags and the `${CLAUDE_PLUGIN_ROOT}` command shape.
- Write the brief to a file first; pass it with `--task-file`.
- Run through `Bash` with `run_in_background` by default. Foreground only when
  the task is expected to be short.
- `id` and `status` are the first two header lines. Keep the ID; resume takes
  the ID and a task file and nothing else.
- One run per ID at a time. Different IDs run in parallel freely.
- After every run, repeat `id`, `status`, `model` and `usage` to the user,
  because Bash output is collapsed in the user's view.
- A conversation can be opened in pi's TUI with
  `pi --session <root>/<id>/session.jsonl`, or exported with `pi --export`.
- Exit codes and the failure modes of section 5.

Policy that lives elsewhere: which agent for which role, at which model, and
continuity rules. The skill links to nothing outside the plugin.

## 7. Testing

`node --test`, no network, no provider calls. Four files, each one seam:

1. `agents.test.mjs`: discovery against a temp agent dir. A good file, a
   list-valued `tools`, non-scalar frontmatter, a missing `name`. Asserts
   resolved prompt, tools, model and rejection messages.
2. `stream.test.mjs`: recorded JSONL fixtures through the consumer. A clean
   run, an `error` stop reason with partial text, one malformed line, a run
   without `agent_settled`. Asserts usage totals, model, status, the printed
   header, and `formatTokens` at 999, 1000, 9999, 10000 and 1M.
3. `lock.test.mjs`: live PID refuses, dead PID is reclaimed, lock released
   after a simulated SIGTERM.
4. `run.test.mjs`: `PI_SUBAGENT_PI` points at a fake `pi` script that records
   its argv, appends a plausible `session.jsonl` at the `--session` path, and
   replays a fixture stream. Covers `start` new, `resume` existing, `resume` of
   an unknown ID, `resume` with `--model` rejected, `--json`, and a non-zero
   exit from the fake. Asserts the exact pi argv.

Gate: `npm run check` runs Prettier check, `node --check` on each script, and
the tests. No TypeScript.

Manual acceptance before phase 2, documented in the README because it costs
provider usage: start `reviewer` on a small brief, resume it with a follow-up,
open the session in pi's TUI and confirm the second turn saw the first.

## 8. Policy rewrite

### chezmoi (`/srv/code/chezmoi`, applied to `~/.claude` and `~/.pi`)

`execute-plan/references/claude.md` role table and mechanism:

| Role | Model | Mechanism |
| --- | --- | --- |
| Standard implementation | sonnet | `Agent` |
| Standard-task review | opus | `Agent`; re-review by `SendMessage` |
| Advanced implementation | opus | `Agent` |
| Advanced-task review | pi `reviewer`, openai-codex/gpt-6-astra | pi-subagent `start`; re-review by `resume <id>` |
| Plan review | pi `plan-reviewer`, openai-codex/gpt-6-astra | same |
| Final whole-change review | pi `reviewer`, openai-codex/gpt-6-astra | same |

Continuity rule unchanged: a re-review goes to the same handle, which for pi
rows is the public ID. Escalation: a standard implementer escalates to opus; an
advanced implementer at the retry cap stops and asks the user, since nothing in
the table sits above opus and astra.

- `review-plan/references/claude.md`: plan review through the pi
  `plan-reviewer` via the skill; keep the rubric-path requirement; drop the
  `Agent`/`fable` instructions.
- Delete both `references/pi.md` files. Each `SKILL.md` capability gate names
  one adapter.
- Keep `~/.claude/agents/plan-reviewer.md`, with its description changed to
  name it as the fallback when pi is unavailable.
- `~/.pi/agent/settings.json`: drop the `pi-subagent` package entry. Role files
  under `~/.pi/agent/agents` stay, including `implementer.md` for ad-hoc use.

### Predator (`/srv/code/predator`)

- `config/agents/workflows.md`: the "Harness capability boundary" section
  becomes one paragraph naming Claude Code as the controller and the
  pi-subagent skill as the route for pi rows. Replace "Pi's stronger-model stop
  applies earlier where its adapter requires it" with the escalation rule above.
- `CLAUDE.md`, "Agent workflows and verification": remove the Pi sentence and
  the `/skill:review-plan` mention.
- `.pi/settings.json` stays: pi children still load the repository's skills
  and prompts.

Records under `docs/records/` are not edited.

## 9. Phasing

1. **Plugin.** Build and test the runtime and skill, install locally, run the
   manual acceptance. chezmoi and Predator are untouched, so the old pi route
   still works while this is proven.
2. **Policy rewrite.** Section 8, chezmoi first, then Predator.
3. **Live progress band, deferred.** The script would write a transient
   `progress.json` per running conversation and a Claude Code hooks module
   would draw a band above the prompt. Early-access API; its own spec when
   wanted. Phases 1 and 2 leave no hook for it.

Each phase is sealed as its own stack of self-contained jj revisions.

Out of scope: job table, status/cancel commands, `/pi:ask`, `/pi:sessions`,
MCP server, Stop-hook review gate, changes to pi role files beyond the
settings entry above.

# pi plugin for Claude Code

Run pi as a resumable subagent from Claude Code. One Node script starts a pi conversation from an
agent definition in `~/.pi/agent/agents`, resumes it by a stable public ID, and prints the model,
usage and status with the final assistant text. The plugin provides the mechanism only; which
agent plays which role is decided by the skills that call it.

Design: `docs/superpowers/specs/2026-10-03-pi-claude-plugin-design.md`. Derived from the subagent
example shipped with `@earendil-works/pi-coding-agent`, with persistence and locking added.

## Requirements

- Node.js 22.18 or later.
- `pi` on `PATH` (tested with `@earendil-works/pi-coding-agent` 1.0.0), with credentials and agent
  files already configured under `~/.pi/agent`. The script imports pi's own frontmatter parser from
  the package behind that binary, so `pi` must resolve to `<package>/dist/bundle/cli.js` as the npm
  global install lays it out; a shell shim in front of it is not supported.

## Install

```
/plugin marketplace add /srv/code/pi-plugin-cc
/plugin install pi@pi-plugin-cc
/reload-plugins
```

The `pi-subagent` skill then appears in the skill list. Read it for the command contract.

## Develop

```sh
npm install --ignore-scripts
npm run setup:jj       # jj fix formats with the local Prettier
npm run check          # Prettier, node --check, node --test
```

Tests use a fake `pi` and never call a provider. They need a real `pi` on `PATH` only to import
its frontmatter parser.

## Manual acceptance

This costs provider usage, so it is not automated. From a trusted checkout:

```sh
printf 'Summarise this repository in three sentences.\n' > /tmp/brief.md
node plugins/pi/scripts/pi-subagent.mjs start --agent reviewer --task-file /tmp/brief.md
printf 'Now name the one file you would read first, and why.\n' > /tmp/brief.md
node plugins/pi/scripts/pi-subagent.mjs resume --id <id from the first header> --task-file /tmp/brief.md
pi --session ~/.pi/agent/claude-subagent-sessions/<id>/session.jsonl
```

Pass when the second answer refers to the first, and pi's interface shows both turns.

## Storage

```
~/.pi/agent/claude-subagent-sessions/<id>/
  session.jsonl   pi's native history
  lock            present only while a run is active; holds the pi process ID
  lock.reclaim    present only for the instant a stale lock is being removed
```

Nothing is deleted automatically. A lock whose process is dead is reclaimed by the next run.

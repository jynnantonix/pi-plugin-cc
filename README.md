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
  the package behind that binary, which it finds by following `pi` to `<package>/dist/bundle/cli.js`
  as the npm global install lays it out. If `pi` is a shell shim (mise, asdf, volta), set
  `PI_SUBAGENT_PACKAGE` to the `@earendil-works/pi-coding-agent` directory instead.

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
  lock            exclusive run marker; holds the launcher process ID
```

Conversations are never deleted automatically; the one exception is a `start` whose pi exited
before writing any session file, whose empty directory is removed. Normal completion and
SIGTERM/SIGINT release the lock after pi closes. A crash or SIGKILL can leave it behind; recovery
is manual. Check that the launcher and any pi process using the session file have stopped before
removing the named lock. A dead launcher alone is not sufficient.

Briefs go through stdin, not process arguments, with no command-line length cap. Children run
with `PI_SUBAGENT=1` and the script refuses to start when it sees that variable, so a pi child
cannot start grandchildren through this plugin.

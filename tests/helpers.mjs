import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCRIPT = join(REPO, "plugins", "pi", "scripts", "pi-subagent.mjs");
export const FAKE_PI = join(REPO, "tests", "fixtures", "fake-pi.mjs");

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

export function runScript(args, { cwd, env = {}, input } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

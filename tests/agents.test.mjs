import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tempDir, writeAgent } from "./helpers.mjs";
import { UsageError } from "../plugins/pi/scripts/lib/errors.mjs";
import { resolvePiBinary, resolvePiPackageDir } from "../plugins/pi/scripts/lib/pi.mjs";
import { allocateId, loadAgent, parseId } from "../plugins/pi/scripts/lib/agents.mjs";

test("resolvePiBinary honours PI_SUBAGENT_PI and falls back to PATH", () => {
  const dir = tempDir();
  const fake = join(dir, "pi");
  writeFileSync(fake, "#!/bin/sh\nexit 0\n");
  chmodSync(fake, 0o755);
  assert.equal(resolvePiBinary({ PATH: "/nonexistent", PI_SUBAGENT_PI: fake }), fake);
  assert.equal(resolvePiBinary({ PATH: dir }), fake);
  assert.throws(() => resolvePiBinary({ PATH: "/nonexistent" }), /pi not found on PATH/);
  assert.throws(() => resolvePiBinary({ PATH: dir, PI_SUBAGENT_PI: join(dir, "missing") }), /not executable/);
  const realPkg = resolvePiPackageDir(process.env);
  assert.match(realPkg, /pi-coding-agent$/);
  assert.equal(resolvePiPackageDir({ PATH: "/nonexistent", PI_SUBAGENT_PACKAGE: realPkg }), realPkg);
  assert.throws(() => resolvePiPackageDir({ PATH: "/nonexistent", PI_SUBAGENT_PACKAGE: dir }), /no dist\/index.js/);
  const dir2 = tempDir();
  mkdirSync(join(dir2, "pi"));
  assert.equal(resolvePiBinary({ PATH: `${dir2}:${dir}` }), fake, "a directory named pi is skipped");
});

test("loadAgent accepts scalar frontmatter and both tools spellings", async () => {
  const agentDir = tempDir();
  writeAgent(agentDir, "reviewer", {
    frontmatter: "name: reviewer\ndescription: Reviews\nmodel: openai-codex/gpt-6-astra\ntools: read, grep, bash\n",
    body: "Review only.\n\nSecond paragraph.",
  });
  const agent = await loadAgent("reviewer", agentDir);
  assert.deepEqual(
    { ...agent, filePath: undefined },
    {
      name: "reviewer",
      description: "Reviews",
      model: "openai-codex/gpt-6-astra",
      tools: ["read", "grep", "bash"],
      systemPrompt: "Review only.\n\nSecond paragraph.",
      filePath: undefined,
    },
  );
  assert.equal(agent.filePath, join(agentDir, "agents", "reviewer.md"));

  writeAgent(agentDir, "worker", { frontmatter: "name: worker\ndescription: Works\ntools:\n  - read\n  - edit\n" });
  const worker = await loadAgent("worker", agentDir);
  assert.deepEqual(worker.tools, ["read", "edit"]);
  assert.equal(worker.model, undefined);
});

test("loadAgent rejects bad names, missing files and non-scalar frontmatter", async () => {
  const agentDir = tempDir();
  await assert.rejects(
    loadAgent("Foo_bar", agentDir),
    (e) => e instanceof UsageError && /invalid agent name/.test(e.message),
  );
  await assert.rejects(
    loadAgent("ghost", agentDir),
    (e) => e instanceof UsageError && /unknown agent "ghost"/.test(e.message),
  );
  writeAgent(agentDir, "nested", { frontmatter: "name: nested\ndescription: x\nmodel:\n  id: y\n" });
  await assert.rejects(loadAgent("nested", agentDir), /"model" must be a plain scalar/);
  writeAgent(agentDir, "nodesc", { frontmatter: "name: nodesc\n" });
  await assert.rejects(loadAgent("nodesc", agentDir), /description is required/);
  writeAgent(agentDir, "renamed", { frontmatter: "name: other\ndescription: x\n" });
  await assert.rejects(loadAgent("renamed", agentDir), /frontmatter name must be "renamed"/);
  writeAgent(agentDir, "badtools", { frontmatter: "name: badtools\ndescription: x\ntools:\n  - read\n  - 7\n" });
  writeAgent(agentDir, "broken", { frontmatter: "name: broken\ndescription: [unclosed\n" });
  await assert.rejects(
    loadAgent("broken", agentDir),
    (e) => e instanceof UsageError && /invalid frontmatter/.test(e.message),
  );
  await assert.rejects(loadAgent("badtools", agentDir), /tools must be/);
});

test("public IDs round-trip the agent name, including hyphenated names", () => {
  const id = allocateId("plan-reviewer");
  assert.match(id, /^plan-reviewer-[0-9a-f]{8}$/);
  assert.equal(parseId(id).agent, "plan-reviewer");
  assert.equal(parseId("reviewer-3f9a1c2e").suffix, "3f9a1c2e");
  assert.throws(() => parseId("reviewer-xyz"), /invalid id/);
  assert.throws(() => parseId("Reviewer-3f9a1c2e"), /invalid id/);
});

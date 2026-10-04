import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tempDir } from "./helpers.mjs";
import { UsageError } from "../plugins/pi/scripts/lib/errors.mjs";
import { acquireLock } from "../plugins/pi/scripts/lib/lock.mjs";

test("one holder per conversation; release cannot remove a later holder's lock", () => {
  const dir = tempDir();
  const path = join(dir, "lock");
  const first = acquireLock(dir);
  assert.equal(readFileSync(path, "utf8"), `${process.pid}\n`);
  assert.throws(() => acquireLock(dir), UsageError);
  // Different conversations remain independent.
  acquireLock(tempDir()).release();
  first.release();
  assert.equal(existsSync(path), false);
  const second = acquireLock(dir);
  first.release();
  assert.equal(existsSync(path), true, "a second release must not unlink the next holder");
  assert.throws(() => acquireLock(dir), UsageError);
  second.release();
  assert.deepEqual(readdirSync(dir), []);
});

test("existing locks always refuse, including dead owners and interrupted writes", () => {
  const deadPid = spawnSync("true").pid;
  for (const content of [`${deadPid}\n`, "", "garbage\n", `${process.pid}\n`]) {
    const dir = tempDir();
    const path = join(dir, "lock");
    writeFileSync(path, content);
    assert.throws(
      () => acquireLock(dir),
      (error) => {
        assert.ok(error instanceof UsageError);
        assert.ok(error.message.includes(path), "refusal identifies the lock to inspect");
        assert.match(error.message, /manual|manually/);
        return true;
      },
    );
    assert.equal(readFileSync(path, "utf8"), content, "refusal must not change the lock");
    assert.deepEqual(readdirSync(dir), ["lock"]);
  }
});

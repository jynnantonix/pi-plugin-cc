import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tempDir } from "./helpers.mjs";
import { UsageError } from "../plugins/pi/scripts/lib/errors.mjs";
import { acquireLock, isAlive, lockPath, reclaim, reclaimMutexPath } from "../plugins/pi/scripts/lib/lock.mjs";

function deadPid() {
  // A process that has already exited; its PID is not reused this quickly.
  return spawnSync("true").pid;
}

test("acquire, busy, update and release", () => {
  const dir = tempDir();
  const lock = acquireLock(dir);
  assert.equal(lock.path, lockPath(dir));
  assert.equal(readFileSync(lock.path, "utf8"), `${process.pid}\n`);
  assert.throws(
    () => acquireLock(dir),
    (e) => e instanceof UsageError && e.message === `busy (pid ${process.pid})`,
  );
  lock.update(4242);
  assert.equal(readFileSync(lock.path, "utf8"), "4242\n");
  assert.deepEqual(readdirSync(dir), ["lock"], "update leaves no temp file");
  lock.release();
  assert.equal(existsSync(lock.path), false);
  lock.release(); // idempotent
  acquireLock(dir).release();
});

test("stale locks are reclaimed; in-flight or fresh unreadable locks are not", () => {
  const dir = tempDir();
  const pid = deadPid();
  assert.equal(isAlive(pid), false);
  assert.equal(isAlive(process.pid), true);
  writeFileSync(lockPath(dir), `${pid}\n`);
  const lock = acquireLock(dir);
  assert.equal(readFileSync(lock.path, "utf8"), `${process.pid}\n`);
  lock.release();

  // Empty or unparseable content is in flight until it is old: a creator between write and link,
  // or a tampered file, must not be stolen.
  writeFileSync(lockPath(dir), "");
  assert.throws(
    () => acquireLock(dir),
    (e) => e instanceof UsageError && e.message === "busy (lock contention)",
  );
  const old = new Date(Date.now() - 60000);
  utimesSync(lockPath(dir), old, old);
  acquireLock(dir).release();
  writeFileSync(lockPath(dir), "garbage\n");
  utimesSync(lockPath(dir), old, old);
  acquireLock(dir).release();
  assert.deepEqual(readdirSync(dir), [], "no private temp files left behind");
});

test("a late reclaim re-judges under the mutex and never touches a live lock", () => {
  const dir = tempDir();
  writeFileSync(lockPath(dir), `${deadPid()}\n`);
  // A reclaims the stale lock and holds it.
  const holder = acquireLock(dir);
  // B judged the old lock stale earlier and only now reclaims: under the mutex it sees A's live lock and leaves it.
  reclaim(dir, lockPath(dir));
  assert.equal(readFileSync(holder.path, "utf8"), `${process.pid}\n`, "A's lock survived B's reclaim");
  assert.deepEqual(readdirSync(dir), ["lock"], "mutex released, no private files left behind");
  assert.throws(
    () => acquireLock(dir),
    (e) => e instanceof UsageError && e.message === `busy (pid ${process.pid})`,
  );
  holder.release();
});

test("a live reclaimer blocks reclaim; a dead reclaimer's mutex is itself reclaimed", () => {
  const dir = tempDir();
  writeFileSync(lockPath(dir), `${deadPid()}\n`);
  writeFileSync(reclaimMutexPath(dir), `${process.pid}\n`);
  assert.throws(
    () => acquireLock(dir),
    (e) => e instanceof UsageError && e.message === "busy (lock contention)",
  );
  writeFileSync(reclaimMutexPath(dir), `${deadPid()}\n`);
  const lock = acquireLock(dir);
  assert.equal(readFileSync(lock.path, "utf8"), `${process.pid}\n`);
  assert.deepEqual(readdirSync(dir), ["lock"]);
  lock.release();
});

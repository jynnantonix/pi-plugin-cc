import { closeSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { UsageError } from "./errors.mjs";

/** Unparseable or empty lock content is treated as in-flight until it is this old. */
const UNREADABLE_STALE_MS = 10000;

export function lockPath(dir) {
  return join(dir, "lock");
}

/** Short-lived mutex that serialises stale-lock reclaim; same create primitive as the lock itself. */
export function reclaimMutexPath(dir) {
  return join(dir, "lock.reclaim");
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function privateName(dir, tag) {
  return join(dir, `.lock.${tag}.${process.pid}.${randomBytes(4).toString("hex")}`);
}

/** Write `<pid>\n` to a private file in dir and return its path; nothing is left behind on failure. */
function writePrivate(dir, pid, tag) {
  const temp = privateName(dir, tag);
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, `${pid}\n`);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // nothing to clean
    }
    throw error;
  } finally {
    closeSync(fd);
  }
  return temp;
}

/** Create the lock with its content already in place: link() fails atomically with EEXIST. */
function tryCreate(dir, path, pid) {
  const temp = writePrivate(dir, pid, "new");
  try {
    linkSync(temp, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(temp);
  }
}

/** The lock's owner as written and its age; null when the file is gone. */
function inspect(path) {
  try {
    const content = readFileSync(path, "utf8");
    const stat = statSync(path);
    return { pid: Number.parseInt(content, 10), ageMs: Date.now() - stat.mtimeMs };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function isStale(owner) {
  if (Number.isInteger(owner.pid) && owner.pid > 0) return !isAlive(owner.pid);
  return owner.ageMs > UNREADABLE_STALE_MS;
}

/**
 * Remove a stale lock under a short-lived mutex, so only one contender judges and removes it and
 * no live lock is ever moved or deleted: the mutex holder inspects `lock` again and unlinks it only
 * if it is still stale. A mutex left by a dead reclaimer is itself stale and is removed first.
 * Exported for the race tests; `acquireLock` is the only production caller.
 */
export function reclaim(dir, path) {
  const mutex = reclaimMutexPath(dir);
  if (!tryCreate(dir, mutex, process.pid)) {
    const holder = inspect(mutex);
    if (holder && !isStale(holder)) throw new UsageError("busy (lock contention)");
    try {
      unlinkSync(mutex);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!tryCreate(dir, mutex, process.pid)) throw new UsageError("busy (lock contention)");
  }
  try {
    const owner = inspect(path);
    if (owner && isStale(owner)) {
      try {
        unlinkSync(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } finally {
    try {
      unlinkSync(mutex);
    } catch {
      // already gone
    }
  }
}

/**
 * One writer per conversation. The file holds the owning PID; a dead owner is stale and reclaimed.
 * The lock is per conversation directory, so independent conversations never contend.
 * Creation and update are atomic (link / rename), so a reader never sees an empty lock.
 */
export function acquireLock(dir, pid = process.pid) {
  const path = lockPath(dir);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreate(dir, path, pid)) {
      return {
        path,
        update(newPid) {
          const temp = writePrivate(dir, newPid, "update");
          try {
            renameSync(temp, path);
          } catch (error) {
            try {
              unlinkSync(temp);
            } catch {
              // nothing to clean
            }
            throw error;
          }
        },
        release() {
          try {
            unlinkSync(path);
          } catch {
            // already released
          }
        },
      };
    }
    const owner = inspect(path);
    if (!owner) continue; // vanished between create and inspect; try again
    if (!isStale(owner)) {
      throw new UsageError(
        Number.isInteger(owner.pid) && owner.pid > 0 ? `busy (pid ${owner.pid})` : "busy (lock contention)",
      );
    }
    reclaim(dir, path);
  }
  throw new UsageError("busy (lock contention)");
}

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.mjs";

/** Exclusive creation only. A crash requires manual recovery; a dead launcher can leave a live child. */
export function acquireLock(dir) {
  const path = join(dir, "lock");
  try {
    writeFileSync(path, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new UsageError(
        `locked: ${path}; after a crash, confirm the launcher and its pi child have stopped before manually removing this file`,
      );
    }
    throw error;
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        unlinkSync(path);
      } catch (error) {
        if (error.code !== "ENOENT")
          process.stderr.write(`pi-subagent: cannot remove lock ${path}: ${error.message}\n`);
      }
    },
  };
}

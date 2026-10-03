import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UsageError } from "./errors.mjs";

export function findOnPath(name, env = process.env) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return resolve(candidate);
    } catch {
      // not here
    }
  }
  return null;
}

/** The binary to spawn. PI_SUBAGENT_PI overrides PATH lookup (tests use a fake). */
export function resolvePiBinary(env = process.env) {
  if (env.PI_SUBAGENT_PI) {
    const path = resolve(env.PI_SUBAGENT_PI);
    try {
      accessSync(path, constants.X_OK);
    } catch {
      throw new UsageError(`PI_SUBAGENT_PI is not executable: ${path}`);
    }
    return path;
  }
  const found = findOnPath("pi", env);
  if (!found) throw new UsageError("pi not found on PATH; install pi or set PI_SUBAGENT_PI");
  return found;
}

/** The installed package behind the real `pi` on PATH: <pkg>/dist/bundle/cli.js → <pkg>. */
export function resolvePiPackageDir(env = process.env) {
  const binary = findOnPath("pi", env);
  if (!binary) throw new UsageError("pi not found on PATH; the pi package is required to read agent files");
  const real = realpathSync(binary);
  const pkg = dirname(dirname(dirname(real)));
  if (!existsSync(join(pkg, "dist", "index.js"))) throw new UsageError(`pi package not found next to ${real}`);
  return pkg;
}

let piModule;
export async function importPi(env = process.env) {
  piModule ??= await import(pathToFileURL(join(resolvePiPackageDir(env), "dist", "index.js")).href);
  return piModule;
}

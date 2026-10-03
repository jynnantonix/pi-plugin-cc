import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UsageError } from "./errors.mjs";

export function findOnPath(name, env = process.env) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return resolve(candidate);
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

/**
 * The installed pi package: PI_SUBAGENT_PACKAGE if set; else the package behind PI_SUBAGENT_PI;
 * else the package behind the real `pi` on PATH (<pkg>/dist/bundle/cli.js → <pkg>).
 */
export function resolvePiPackageDir(env = process.env) {
  if (env.PI_SUBAGENT_PACKAGE) {
    const pkg = resolve(env.PI_SUBAGENT_PACKAGE);
    if (!existsSync(join(pkg, "dist", "index.js")))
      throw new UsageError(`PI_SUBAGENT_PACKAGE has no dist/index.js: ${pkg}`);
    return pkg;
  }
  const binary = env.PI_SUBAGENT_PI ? resolve(env.PI_SUBAGENT_PI) : findOnPath("pi", env);
  if (!binary)
    throw new UsageError(
      "pi not found on PATH; the pi package is required to read agent files (set PI_SUBAGENT_PACKAGE to its directory)",
    );
  const real = realpathSync(binary);
  const pkg = dirname(dirname(dirname(real)));
  if (!existsSync(join(pkg, "dist", "index.js"))) {
    throw new UsageError(
      `pi package not found next to ${real}; if pi is a shim, set PI_SUBAGENT_PACKAGE to the @earendil-works/pi-coding-agent directory`,
    );
  }
  return pkg;
}

let piModule;
export async function importPi(env = process.env) {
  piModule ??= await import(pathToFileURL(join(resolvePiPackageDir(env), "dist", "index.js")).href);
  return piModule;
}

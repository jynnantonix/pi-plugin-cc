import { readFileSync } from "node:fs";
import { UsageError } from "./errors.mjs";

/** cwd from the session header and the latest model_change on the file. Only the header must parse. */
export function readSessionInfo(file) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`cannot read ${file}`);
  }
  const lines = content.split("\n").filter((line) => line.trim());
  let header = null;
  try {
    header = lines.length ? JSON.parse(lines[0]) : null;
  } catch {
    header = null;
  }
  if (!header || header.type !== "session" || typeof header.cwd !== "string") {
    throw new UsageError(`${file}: no session header; start a new conversation instead`);
  }
  let model = null;
  for (const line of lines.slice(1)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // pi is authoritative for damaged tails
    }
    if (entry?.type === "model_change" && entry.provider && entry.modelId) model = `${entry.provider}/${entry.modelId}`;
  }
  return { cwd: header.cwd, model };
}

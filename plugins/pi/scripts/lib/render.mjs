import { formatUsage } from "./format.mjs";

/** The final text as printed and as written to a report file: newline-terminated unless empty. */
export function renderText(result) {
  return `${result.text}${result.text ? "\n" : ""}`;
}

export function renderHeader(result) {
  const lines = [
    `id: ${result.id}`,
    `status: ${result.status}`,
    `run: ${result.run}`,
    `model: ${result.model ?? "unknown"}`,
    `thinking: ${result.thinking ?? "unknown"}`,
    `cwd: ${result.cwd}`,
  ];
  if (result.modelMismatch) lines.push(`model-mismatch: ${result.modelMismatch}`);
  if (result.cwdNote) lines.push(`cwd-note: ${result.cwdNote}`);
  lines.push(`usage: ${formatUsage(result.usage)}`);
  return `${lines.join("\n")}\n\n${renderText(result)}`;
}

export function renderJson(result) {
  return `${JSON.stringify(result)}\n`;
}

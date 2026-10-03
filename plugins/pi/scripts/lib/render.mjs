import { formatUsage } from "./format.mjs";

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
  return `${lines.join("\n")}\n\n${result.text}${result.text ? "\n" : ""}`;
}

export function renderJson(result) {
  return `${JSON.stringify(result)}\n`;
}

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "./errors.mjs";
import { importPi } from "./pi.mjs";

export const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;
export const PUBLIC_ID = /^([a-z0-9][a-z0-9-]*)-([0-9a-f]{8})$/;

export function agentFile(agentDir, name) {
  return join(agentDir, "agents", `${name}.md`);
}

const scalar = (value) => ["string", "number", "boolean"].includes(typeof value);

function toolList(value, filePath) {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!raw || !raw.every((tool) => typeof tool === "string")) {
    throw new UsageError(`${filePath}: tools must be a comma-separated string or a list of strings`);
  }
  const tools = raw.map((tool) => tool.trim()).filter(Boolean);
  return tools.length ? tools : undefined;
}

/** Read <agentDir>/agents/<name>.md. Frontmatter: name, description, optional model, optional tools. */
export async function loadAgent(name, agentDir) {
  if (!AGENT_NAME.test(name)) {
    throw new UsageError(`invalid agent name "${name}": use lowercase letters, digits and hyphens`);
  }
  const filePath = agentFile(agentDir, name);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new UsageError(`unknown agent "${name}": ${filePath} not found`);
  }
  const { parseFrontmatter } = await importPi();
  let frontmatter, body;
  try {
    ({ frontmatter, body } = parseFrontmatter(content));
  } catch (error) {
    throw new UsageError(`${filePath}: invalid frontmatter: ${error.message}`);
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    const ok = key === "tools" ? scalar(value) || Array.isArray(value) : scalar(value);
    if (!ok) throw new UsageError(`${filePath}: frontmatter "${key}" must be a plain scalar`);
  }
  if (frontmatter.name !== name) throw new UsageError(`${filePath}: frontmatter name must be "${name}"`);
  if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    throw new UsageError(`${filePath}: frontmatter description is required`);
  }
  if (frontmatter.model !== undefined && typeof frontmatter.model !== "string") {
    throw new UsageError(`${filePath}: model must be a string`);
  }
  return {
    name,
    description: frontmatter.description,
    model: frontmatter.model,
    tools: toolList(frontmatter.tools, filePath),
    systemPrompt: body,
    filePath,
  };
}

export function allocateId(agentName) {
  return `${agentName}-${randomBytes(4).toString("hex")}`;
}

export function parseId(id) {
  const match = PUBLIC_ID.exec(id);
  if (!match) throw new UsageError(`invalid id "${id}": expected <agent>-<8 hex digits>`);
  return { agent: match[1], suffix: match[2] };
}

// Token and usage formatting, derived from pi's subagent example.

export function formatTokens(count) {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsage(usage) {
  const parts = [`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`];
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  const denominator = usage.input + usage.cacheRead;
  if (denominator > 0) parts.push(`cache ${Math.round((usage.cacheRead / denominator) * 100)}%`);
  if (usage.contextTokens) parts.push(`ctx ${formatTokens(usage.contextTokens)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(2)}`);
  return parts.join(" ");
}

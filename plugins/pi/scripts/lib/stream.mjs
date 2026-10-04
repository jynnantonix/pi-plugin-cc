import { StringDecoder } from "node:string_decoder";

export function emptyUsage() {
  return { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
}

/**
 * Consume pi's JSONL event stream (docs/json.md). Split on LF only, strip a trailing CR, decode UTF-8
 * across chunk boundaries. Only message_end (assistant), agent_start, agent_settled and
 * thinking_level_changed are retained; deltas and tool events are dropped.
 *
 * `thinking` comes from the assistant message's `thinkingLevel`, which pi 1.0.0 writes (see a real
 * session file) but docs/message-types.md does not list. If a later pi drops it, the header shows
 * `thinking: unknown`; nothing else depends on it.
 */
export function createCollector() {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const state = {
    assistant: null,
    usage: emptyUsage(),
    model: null,
    thinking: null,
    stopReason: null,
    errorMessage: null,
    started: false,
    settled: false,
    malformed: 0,
  };

  const handle = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      state.malformed += 1;
      return;
    }
    if (!event || typeof event !== "object") {
      state.malformed += 1;
      return;
    }
    switch (event.type) {
      case "agent_start":
        state.started = true;
        state.settled = false;
        break;
      case "agent_settled":
        if (state.started) state.settled = true;
        break;
      case "thinking_level_changed":
        if (typeof event.level === "string") state.thinking = event.level;
        break;
      case "message_end": {
        const message = event.message;
        if (!message || message.role !== "assistant") break;
        state.assistant = message;
        const usage = message.usage ?? {};
        state.usage.turns += 1;
        state.usage.input += usage.input || 0;
        state.usage.output += usage.output || 0;
        state.usage.cacheRead += usage.cacheRead || 0;
        state.usage.cacheWrite += usage.cacheWrite || 0;
        state.usage.cost += usage.cost?.total || 0;
        if (usage.totalTokens) state.usage.contextTokens = usage.totalTokens;
        if (message.provider && message.model) state.model = `${message.provider}/${message.model}`;
        if (typeof message.thinkingLevel === "string") state.thinking = message.thinkingLevel;
        state.stopReason = message.stopReason ?? null;
        state.errorMessage = message.errorMessage ?? null;
        break;
      }
      default:
        break;
    }
  };

  const consume = (text) => {
    buffer += text;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  };

  return {
    state,
    push(chunk) {
      consume(Buffer.isBuffer(chunk) ? decoder.write(chunk) : chunk);
    },
    end() {
      consume(decoder.end());
      if (buffer) handle(buffer);
      buffer = "";
    },
  };
}

export function finalText(state) {
  const content = state.assistant?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

/**
 * Successful completion requires a settled, error-free run. Report the most informative cause
 * first (what pi said), parser trouble last and appended to any earlier reason.
 */
export function evaluate(state, { exitCode, stderr, signal }) {
  const trimmedStderr = (stderr ?? "").trim();
  const malformed = state.malformed ? `${state.malformed} malformed JSON record(s) in pi output` : null;
  const fail = (reason) => ({
    ok: false,
    reason: malformed && reason !== malformed ? `${reason}; ${malformed}` : reason,
  });
  if (signal) return fail(`aborted (${signal})`);
  if (state.stopReason === "error" || state.stopReason === "aborted") {
    return fail(state.errorMessage || `stop reason ${state.stopReason}`);
  }
  if (exitCode !== 0) return fail(trimmedStderr || `exit ${exitCode}`);
  if (!state.assistant) return fail(trimmedStderr || "no completed assistant response");
  if (!state.settled) return fail(trimmedStderr || "pi exited without settling");
  if (malformed) return fail(malformed);
  return { ok: true };
}

/**
 *
 * Verifies:
 *   1. Trimmer output is always schema-valid (no orphaned tool_use/tool_result).
 *   2. The 3 most recent turns are always preserved verbatim.
 *   3. System message is always preserved.
 *   4. In-flight tool_use/tool_result pairs are never split.
 *   5. 40K-token synthetic conversation with 15 tool_result blocks trims correctly.
 */

import { describe, it, expect } from "vitest";
import { trimRequestBody } from "../../src/lib/tokensaver/trim.js";

// Build a synthetic message with approximate token count
function textOf(tokens) {
  return "x".repeat(tokens * 4); // charCount ÷ 4 ≈ tokens
}

function makeConversation({ turns = 10, toolPairs = 0, extraTokensPerMsg = 100 } = {}) {
  const messages = [{ role: "system", content: "You are a helpful assistant." }];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: "user", content: textOf(extraTokensPerMsg) });
    if (i < toolPairs) {
      const id = `tool-${i}`;
      messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "fn", arguments: "{}" } }] });
      messages.push({ role: "tool", tool_call_id: id, content: textOf(extraTokensPerMsg) });
    } else {
      messages.push({ role: "assistant", content: textOf(extraTokensPerMsg) });
    }
  }
  return messages;
}

function hasOrphanedToolPair(messages) {
  // Collect all tool_call ids referenced in tool result messages
  const resultIds = new Set(
    messages.filter((m) => m.role === "tool" && m.tool_call_id).map((m) => m.tool_call_id)
  );
  // Collect all tool_call ids defined in assistant messages
  const callIds = new Set(
    messages.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls.map((tc) => tc.id) : []))
  );
  // Orphaned result: result without matching call
  for (const id of resultIds) {
    if (!callIds.has(id)) return true;
  }
  // Orphaned call: call without matching result
  for (const id of callIds) {
    if (!resultIds.has(id)) return true;
  }
  return false;
}

describe("token trimmer", () => {
  it("returns body unchanged when disabled", () => {
    const body = { messages: makeConversation({ turns: 5 }) };
    const original = JSON.stringify(body);
    trimRequestBody(body, 100, false);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("returns body unchanged when already within budget", () => {
    const body = { messages: makeConversation({ turns: 2, extraTokensPerMsg: 10 }) };
    const before = body.messages.length;
    trimRequestBody(body, 100_000, true);
    expect(body.messages.length).toBe(before);
  });

  it("always preserves system message", () => {
    const body = { messages: makeConversation({ turns: 20, extraTokensPerMsg: 500 }) };
    trimRequestBody(body, 1000, true);
    expect(body.messages.some((m) => m.role === "system")).toBe(true);
  });

  it("always preserves 3 most recent user+assistant turns", () => {
    const messages = makeConversation({ turns: 20, extraTokensPerMsg: 500 });
    const body = { messages };
    // Capture last 6 non-system messages (3 user + 3 assistant)
    const nonSystem = messages.filter((m) => m.role !== "system");
    const last6 = nonSystem.slice(-6).map((m) => m.content);

    trimRequestBody(body, 500, true);

    const trimmedNonSystem = body.messages.filter((m) => m.role !== "system");
    const trimmedLast = trimmedNonSystem.slice(-6).map((m) => m.content);
    expect(trimmedLast).toEqual(last6);
  });

  it("never orphans tool_use/tool_result pairs", () => {
    const body = { messages: makeConversation({ turns: 20, toolPairs: 15, extraTokensPerMsg: 200 }) };
    trimRequestBody(body, 2000, true);
    expect(hasOrphanedToolPair(body.messages)).toBe(false);
  });

  it("40K-token conversation with 15 tool_result blocks trims to budget", () => {
    // ~40K tokens: 100 turns × 2 messages × ~200 tokens each = 40K
    const body = { messages: makeConversation({ turns: 100, toolPairs: 15, extraTokensPerMsg: 200 }) };
    const budget = 8000; // trim to ~8K
    trimRequestBody(body, budget, true);

    // No orphaned pairs
    expect(hasOrphanedToolPair(body.messages)).toBe(false);

    // System message preserved
    expect(body.messages.some((m) => m.role === "system")).toBe(true);

    // Rough token count should be near budget (within 2x for approximation)
    const approxTokens = body.messages.reduce((s, m) => {
      const c = m.content;
      return s + (typeof c === "string" ? Math.ceil(c.length / 4) : 0) + 4;
    }, 0);
    expect(approxTokens).toBeLessThan(budget * 2);
  });

  it("handles body.input (OpenAI Responses API shape)", () => {
    const body = { input: makeConversation({ turns: 20, extraTokensPerMsg: 500 }) };
    trimRequestBody(body, 1000, true);
    expect(body.input.some((m) => m.role === "system")).toBe(true);
    expect(hasOrphanedToolPair(body.input)).toBe(false);
  });
});

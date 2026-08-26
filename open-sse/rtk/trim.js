/**
 * Sliding-window context trimmer.
 *
 * Trims a messages array to fit within a token budget while:
 *   1. Always preserving the N most recent turns verbatim (PRESERVE_RECENT_TURNS).
 *   2. Always preserving every in-flight tool_use/tool_result pair (never orphaned).
 *   3. Always preserving the system message.
 *   4. Trimming from the oldest non-system, non-preserved messages first.
 *
 * Token counting: character-based approximation (÷4) — fast, no tokenizer dep.
 * Accurate enough for budget gating; real tokenizer can replace the counter
 * without changing the algorithm.
 *
 * Supports OpenAI (messages[]), Claude (messages[] with content blocks), and
 * Gemini (contents[]) shapes. Gemini is passed through untouched (different
 * structure; headroom handles it).
 *
 * Fail-open: any error returns the original body unchanged.
 *
 * ponytail: replace charCount with tiktoken when available as optional dep.
 */

const PRESERVE_RECENT_TURNS = 3; // always keep last N user+assistant pairs

/** Approximate token count from a value (JSON-serialised). */
function charCount(value) {
  if (value == null) return 0;
  if (typeof value === "string") return Math.ceil(value.length / 4);
  try { return Math.ceil(JSON.stringify(value).length / 4); } catch { return 0; }
}

function messageTokens(msg) {
  return charCount(msg?.content) + charCount(msg?.tool_calls) + 4; // 4 = role overhead
}

/**
 * Collect indices of tool_use blocks and their paired tool_result messages.
 * Returns a Set of message indices that must not be trimmed.
 */
function collectToolPairs(messages) {
  const protected_ = new Set();
  // Map tool_use id → index of the assistant message containing it
  const toolUseIdx = new Map();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    // OpenAI: assistant with tool_calls
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.id) toolUseIdx.set(tc.id, i);
      }
    }

    // Claude: content blocks with tool_use
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_use" && block.id) toolUseIdx.set(block.id, i);
      }
    }

    // OpenAI: tool result message
    if (msg.role === "tool" && msg.tool_call_id) {
      const srcIdx = toolUseIdx.get(msg.tool_call_id);
      if (srcIdx !== undefined) {
        protected_.add(srcIdx);
        protected_.add(i);
      }
    }

    // Claude: tool_result blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_result" && block.tool_use_id) {
          const srcIdx = toolUseIdx.get(block.tool_use_id);
          if (srcIdx !== undefined) {
            protected_.add(srcIdx);
            protected_.add(i);
          }
        }
      }
    }
  }

  return protected_;
}

/**
 * Trim a messages array to fit within tokenBudget.
 * @param {object[]} messages
 * @param {number} tokenBudget
 * @returns {object[]} trimmed messages (new array, originals untouched)
 */
function trimMessages(messages, tokenBudget) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  // Identify protected indices
  const toolProtected = collectToolPairs(messages);

  // System message index (always protected)
  const systemIdx = messages.findIndex((m) => m?.role === "system" || m?.role === "developer");

  // Recent turns: last PRESERVE_RECENT_TURNS user+assistant pairs
  const recentProtected = new Set();
  let turns = 0;
  for (let i = messages.length - 1; i >= 0 && turns < PRESERVE_RECENT_TURNS * 2; i--) {
    const role = messages[i]?.role;
    if (role === "user" || role === "assistant") {
      recentProtected.add(i);
      turns++;
    }
  }

  // Build candidate list for trimming (oldest first, non-protected)
  const candidates = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === systemIdx) continue;
    if (toolProtected.has(i)) continue;
    if (recentProtected.has(i)) continue;
    candidates.push(i);
  }

  // Calculate current total tokens
  let total = messages.reduce((s, m) => s + messageTokens(m), 0);
  if (total <= tokenBudget) return messages;

  // Mark indices to drop (oldest candidates first)
  const drop = new Set();
  for (const idx of candidates) {
    if (total <= tokenBudget) break;
    total -= messageTokens(messages[idx]);
    drop.add(idx);
  }

  return messages.filter((_, i) => !drop.has(i));
}

/**
 * Apply sliding-window trim to a request body.
 * Mutates body.messages (or body.input) in-place for efficiency.
 *
 * @param {object} body          - Request body
 * @param {number} tokenBudget   - Max tokens for the messages array
 * @param {boolean} enabled      - Feature flag; returns body unchanged if false
 * @returns {object} body (same reference)
 */
export function trimRequestBody(body, tokenBudget, enabled) {
  if (!enabled || !body || tokenBudget <= 0) return body;
  try {
    if (Array.isArray(body.messages)) {
      body.messages = trimMessages(body.messages, tokenBudget);
    } else if (Array.isArray(body.input)) {
      body.input = trimMessages(body.input, tokenBudget);
    }
  } catch {
    // Fail-open
  }
  return body;
}

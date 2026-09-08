/**
 * Condensed system prompt for internal Auto Plan-Then-Code step.
 * Keeps output strictly bounded to <PLAN>...</PLAN> with task breakdown,
 * files to touch, and pseudocode/architecture.
 */
export const CONDENSED_PLAN_PROMPT = `You are a software architect. The user is requesting a non-trivial code implementation or architecture change.
Analyze the request and generate a concise, structured implementation plan.

Format your response STRICTLY inside <PLAN>...</PLAN> tags as follows:
<PLAN>
## Overview
Brief 1-2 sentence architecture summary.

## Proposed Changes
List of files to create/edit and their concrete responsibilities.

## Implementation Steps & Verification
1. Step 1 (Key functions / types / components)
2. Step 2 (Wiring & edge cases)
3. Self-check verification (tests or assertions)
</PLAN>

Rules:
- Output ONLY the <PLAN>...</PLAN> block.
- Keep it concise, high-signal, zero fluff. No explanations outside the tags.
- Focus on concrete file paths, API contracts, and key algorithms.`;

/**
 * Keywords and patterns for heuristic classification
 */
const BUILD_KEYWORDS = [
  /\bbuild\b/i,
  /\bimplement\b/i,
  /\bcreate app\b/i,
  /\brefactor\b/i,
  /\barchitecture\b/i,
  /\barchitect\b/i,
  /\bdesign system\b/i,
  /\bendpoint\b/i,
  /\bmodule\b/i,
  /\bfull-stack\b/i,
  /\bmicroservice\b/i,
  /\bbangun\b/i,
  /\bbuatkan\b/i,
  /\brancang\b/i,
  /\barsitektur\b/i,
  /\bsistem\b/i,
  /\bfitur baru\b/i,
  /\baplikasi\b/i,
];

const MULTI_SCOPE_PATTERNS = [
  /\b(across|multiple|several|many)\s+files?\b/i,
  /\b(beberapa|banyak)\s+file\b/i,
  /\bend-to-end\b/i,
  /\be2e\b/i,
  /\bfull feature\b/i,
  /\b(frontend|client).*(backend|server|api|database|db)\b/i,
  /\b(backend|server|api|database|db).*(frontend|client)\b/i,
  /\b(auth|authentication).*(database|db|session|token)\b/i,
  /\b\d+\.\s+[A-Za-z]/, // numbered list items (1. 2. 3.)
];

const EXCLUSION_PATTERNS = [
  /\b(why|kenapa|mengapa|how does|jelaskan|explain)\b/i,
  /\b(typo|fix typo|one-line|spelling|syntax error)\b/i,
  /\b(what is|apa itu|apakah)\b/i,
];

/**
 * Extract plain text content from a message content field
 */
export function extractText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "text") return c.text;
        if (c && typeof c.text === "string") return c.text;
        return "";
      })
      .join(" ");
  }
  return String(content || "");
}

/**
 * Tier 1 Heuristic Classifier (0 extra tokens, sync, pure JS)
 * @param {Array} messages - Chat messages array
 * @param {object} settings - Settings object containing complexity_threshold
 * @returns {{ needsPlan: boolean, confidence: number, score: number, reason: string }}
 */
export function classifyHeuristic(messages, settings = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { needsPlan: false, confidence: 1.0, score: 0, reason: "empty_messages" };
  }

  // 1. Anti double-plan check: already contains <PLAN>
  const hasExistingPlan = messages.some((m) => {
    const text = extractText(m?.content);
    return text.includes("<PLAN>") || text.includes("</PLAN>");
  });
  if (hasExistingPlan) {
    return { needsPlan: false, confidence: 1.0, score: 0, reason: "already_planned" };
  }

  // 2. Tool-calling loop check: Claude Code / Cursor agent loop
  const hasToolSignals = messages.some((m) => {
    if (m?.role === "tool" || m?.role === "function") return true;
    if (Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) return true;
    if (Array.isArray(m?.content) && m.content.some((b) => b?.type === "tool_use" || b?.type === "tool_result")) {
      return true;
    }
    return false;
  });
  if (hasToolSignals) {
    return { needsPlan: false, confidence: 1.0, score: 0, reason: "agent_tool_loop" };
  }

  // 3. Inspect the latest user message
  const userMessages = messages.filter((m) => m?.role === "user");
  const lastUserMsg = userMessages[userMessages.length - 1];
  if (!lastUserMsg) {
    return { needsPlan: false, confidence: 1.0, score: 0, reason: "no_user_turn" };
  }

  const text = extractText(lastUserMsg.content).trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Very short query (< 8 words) is almost never an architecture task
  if (wordCount < 8) {
    return { needsPlan: false, confidence: 0.95, score: 0.1, reason: "too_short" };
  }

  // Check exclusion patterns for simple questions / typo fixes
  if (EXCLUSION_PATTERNS.some((p) => p.test(text))) {
    // If it also mentions build/refactor heavily, don't drop to 0 completely, but penalize
    const hasBuildWord = BUILD_KEYWORDS.some((p) => p.test(text));
    if (!hasBuildWord || wordCount < 25) {
      return { needsPlan: false, confidence: 0.9, score: 0.1, reason: "exclusion_pattern" };
    }
  }

  let score = 0;

  // Length factor: prompts with architecture keywords suggest bigger tasks
  if (wordCount >= 12) score += 0.15;
  if (wordCount >= 25) score += 0.15;
  if (wordCount >= 50) score += 0.15;

  // Count build keywords
  let buildMatches = 0;
  for (const pattern of BUILD_KEYWORDS) {
    if (pattern.test(text)) buildMatches++;
  }
  score += Math.min(0.4, buildMatches * 0.2);

  // Count multi-scope patterns
  let scopeMatches = 0;
  for (const pattern of MULTI_SCOPE_PATTERNS) {
    if (pattern.test(text)) scopeMatches++;
  }
  score += Math.min(0.4, scopeMatches * 0.2);

  // If both strong build and multi-scope are present, apply synergy boost
  if (buildMatches >= 1 && scopeMatches >= 1) {
    score += 0.2;
  }

  // Normalize score between 0 and 1
  score = Math.min(1.0, Math.max(0.0, score));

  // Threshold is 1-10 slider in settings (default 6 -> 0.6)
  const thresholdRaw = settings.autoPlanComplexityThreshold !== undefined
    ? Number(settings.autoPlanComplexityThreshold)
    : 6;
  const threshold = Math.min(1.0, Math.max(0.1, thresholdRaw / 10));

  const needsPlan = score >= threshold;
  // Distance from threshold indicates confidence (far = high confidence, close = ambiguous)
  const distance = Math.abs(score - threshold);
  const confidence = Math.min(1.0, 0.5 + distance);

  return {
    needsPlan,
    confidence,
    score: Number(score.toFixed(3)),
    threshold,
    reason: needsPlan ? "heuristic_match" : "below_threshold",
  };
}

/**
 * Classify entry point with optional Tier 2 (LLM-assisted) for ambiguous cases
 */
export async function classifyRequest(messages, settings = {}, options = {}) {
  const t1 = classifyHeuristic(messages, settings);

  // If smart_classify is disabled or confidence is high, use Tier 1 directly
  const smartClassify = !!settings.autoPlanSmartClassify;
  if (!smartClassify || t1.confidence >= 0.75 || !options.handleSingleModelChat) {
    return t1;
  }

  // Tier 2: LLM call locked with max_tokens: 20
  try {
    const lastUser = extractText(messages.filter((m) => m?.role === "user").pop()?.content).trim();
    const prompt = `Jawab hanya YES atau NO: apakah task berikut butuh perencanaan arsitektur multi-langkah sebelum ditulis kodenya?\nTask: "${lastUser.slice(0, 300)}"`;

    const cheapModel = options.classifyModel || "gpt-4o-mini";
    const syntheticReq = {
      url: "http://localhost:20128/v1/chat/completions",
      headers: new Headers({
        "content-type": "application/json",
        "x-9router-auto-plan": "off",
        "x-9router-skill-router": "off",
      }),
    };
    const syntheticBody = {
      model: cheapModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 20,
      temperature: 0.1,
      stream: false,
    };

    const res = await options.handleSingleModelChat(syntheticBody, cheapModel, null, syntheticReq);
    if (!res || !res.ok) return t1; // fail-open to Tier 1 result

    const data = await res.json();
    const answer = String(data.choices?.[0]?.message?.content || "").trim().toUpperCase();
    const needsPlan = answer.startsWith("YES") || answer.includes("YES");

    return {
      needsPlan,
      confidence: 0.9,
      score: needsPlan ? 0.9 : 0.1,
      reason: "tier2_llm_classified",
      tokens: data.usage?.total_tokens || 0,
    };
  } catch {
    // Fail-open to Tier 1
    return t1;
  }
}

/**
 * Find Plan Combo (highest subscription/paid combo containing 'claude')
 */
export function resolvePlanCombo(combos = [], settings = {}) {
  if (settings.autoPlanMode === "manual" && settings.autoPlanComboId) {
    const found = combos.find((c) => c.id === settings.autoPlanComboId || c.name === settings.autoPlanComboId);
    if (found) return found;
  }

  // Auto mode: find active combo with claude model
  const claudeCombo = combos.find((c) => {
    const models = Array.isArray(c.models) ? c.models : [];
    return models.some((m) => {
      const id = typeof m === "string" ? m : m?.id || "";
      return id.toLowerCase().includes("claude");
    });
  });

  if (claudeCombo) return claudeCombo;

  // Fallback to any combo if no claude combo found
  return combos[0] || null;
}

/**
 * Find Code Combo
 */
export function resolveCodeCombo(combos = [], settings = {}, originalModel = null) {
  if (settings.autoPlanMode === "manual" && settings.autoCodeComboId) {
    const found = combos.find((c) => c.id === settings.autoCodeComboId || c.name === settings.autoCodeComboId);
    if (found) return found;
  }

  // Default: if original model is a combo, reuse it
  if (originalModel) {
    const matching = combos.find((c) => c.name === originalModel || c.id === originalModel);
    if (matching) return matching;
  }

  return null;
}

/**
 * Inject plan text into messages array
 */
export function injectPlan(messages, planText) {
  if (!planText || typeof planText !== "string") return messages;
  const list = [...(messages || [])];
  // Insert plan into a system message or assistant guidance before the last user turn
  const planBlock = `The following architecture plan was generated for this implementation task:\n${planText.trim()}\nImplement the code following this plan faithfully.`;
  
  // Find last user turn
  let lastUserIdx = list.length - 1;
  while (lastUserIdx >= 0 && list[lastUserIdx]?.role !== "user") {
    lastUserIdx--;
  }

  if (lastUserIdx >= 0) {
    list.splice(lastUserIdx, 0, {
      role: "system",
      content: planBlock,
    });
  } else {
    list.unshift({
      role: "system",
      content: planBlock,
    });
  }

  return list;
}

/**
 * Strip plan markers from responses if show_plan_in_response is false
 */
export function stripPlanMarkersForClient(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/<PLAN>[\s\S]*?<\/PLAN>\s*/gi, "").trim();
}

import { appendHermesMemoryEntry, HERMES_MEMORY_BYPASS_HEADER } from "./memory.js";
import { getSession } from "@/lib/session/cache.js";

const DEFAULT_COOLDOWN_MS = 60000;
const EXTRACTION_TIMEOUT_MS = 15000;

export const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction assistant. Analyze the user's latest message and extract important persistent facts.
Return a JSON object with this EXACT structure:
{
  "user": ["User preferences, coding styles, tools used, specific constraints"],
  "memory": ["Project architecture facts, specific repo conventions, setup steps, key decisions"]
}
Rules:
- If nothing worth remembering, return {"user": [], "memory": []}.
- Keep each fact concise (under 200 characters).
- Do not extract trivial greetings, temporary queries, or questions.
- Respond with valid JSON only. No markdown fences, no text before or after.`;

export function shouldExtractMemory({ text, sessionId, cooldownSeconds = 60 }) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();
  if (clean.length < 25) return false;

  // Keyword check
  const triggers = /remember|preference|prefer|always|never|rule|convention|my name is|i use|i work on|project uses|stack is|database is/i;
  if (!triggers.test(clean)) return false;

  if (sessionId) {
    const session = getSession(sessionId);
    if (session && session.lastMemoryExtractionAt) {
      const elapsed = Date.now() - session.lastMemoryExtractionAt;
      const cooldownMs = (cooldownSeconds || 60) * 1000;
      if (elapsed < cooldownMs) {
        return false;
      }
    }
  }

  return true;
}

export function parseExtractionResponse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { user: [], memory: [] };
  }

  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    const user = Array.isArray(parsed.user) ? parsed.user.filter(e => typeof e === "string" && e.trim()).map(e => e.trim()) : [];
    const memory = Array.isArray(parsed.memory) ? parsed.memory.filter(e => typeof e === "string" && e.trim()).map(e => e.trim()) : [];
    return { user, memory };
  } catch {
    return { user: [], memory: [] };
  }
}

export async function extractMemoryWithLLM({
  text,
  handleSingleModelChat,
  extractionModel = "gpt-4o-mini",
  apiKey = null,
}) {
  const syntheticReq = {
    url: "http://localhost:20128/v1/chat/completions",
    headers: new Headers({
      "content-type": "application/json",
      [HERMES_MEMORY_BYPASS_HEADER]: "off",
      "x-9router-skill-router": "off",
    }),
  };

  const syntheticBody = {
    model: extractionModel,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    temperature: 0.1,
    max_tokens: 400,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const response = await handleSingleModelChat(
      syntheticBody,
      extractionModel,
      null,
      syntheticReq,
      apiKey
    );

    clearTimeout(timeoutId);

    if (!response || !response.ok) {
      return { user: [], memory: [] };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return parseExtractionResponse(content);
  } catch {
    clearTimeout(timeoutId);
    return { user: [], memory: [] };
  }
}

export function triggerHermesExtraction({
  text,
  sessionId,
  settings = {},
  handleSingleModelChat,
  apiKey = null,
  log,
}) {
  const hermesToolkitEnabled = settings["hermes-toolkitEnabled"] !== undefined
    ? !!settings["hermes-toolkitEnabled"]
    : settings.hermesToolkitEnabled !== undefined
      ? !!settings.hermesToolkitEnabled
      : true;

  const autoSave = settings.hermes_auto_save_memory !== undefined
    ? !!settings.hermes_auto_save_memory
    : settings.auto_save_memory !== undefined
      ? !!settings.auto_save_memory
      : true;

  if (!hermesToolkitEnabled || !autoSave) {
    return;
  }

  const cooldownSeconds = settings.hermes_extraction_cooldown_seconds || settings.extraction_cooldown_seconds || 60;
  if (!shouldExtractMemory({ text, sessionId, cooldownSeconds })) {
    return;
  }

  // Update session cooldown timestamp immediately
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      session.lastMemoryExtractionAt = Date.now();
    }
  }

  const mode = settings.hermes_extraction_mode || settings.extraction_mode || "rule_based";
  const extractionModel = settings.hermes_extraction_model || settings.extraction_model || "gpt-4o-mini";

  Promise.resolve().then(async () => {
    try {
      if (mode === "llm" && typeof handleSingleModelChat === "function") {
        const extracted = await extractMemoryWithLLM({
          text,
          handleSingleModelChat,
          extractionModel,
          apiKey,
        });

        for (const entry of extracted.user.slice(0, 3)) {
          await appendHermesMemoryEntry("user", entry);
        }
        for (const entry of extracted.memory.slice(0, 3)) {
          await appendHermesMemoryEntry("memory", entry);
        }
      } else {
        // Fallback / rule_based mode
        await appendHermesMemoryEntry("user", `User note: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      if (log) {
        log.warn("HERMES", `Hermes background extraction failed: ${err.message}`);
      }
    }
  });
}

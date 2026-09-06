import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import {
  FETCH_CONNECT_TIMEOUT_MS,
  DEFAULT_RETRY_CONFIG,
  resolveRetryEntry,
} from "../config/runtimeConfig.js";
import { markPoolUnfit, clearPoolUnfit } from "../services/proxyPoolFitness.js";

/**
 * Freebuff Executor — OpenAI-compatible chat completions on
 * https://www.codebuff.com/api/v1/chat/completions (the Codebuff/Freebuff backend).
 *
 * Wire shape mirrors the official CLI exactly. The CLI (Vercel AI SDK with the
 * codebuff openai-compatible provider) builds `providerOptions.codebuff` =
 * { codebuff_metadata, provider } and the provider spreads those entries at
 * the TOP LEVEL of the request body — i.e. the body is:
 *   { model, messages, codebuff_metadata: { run_id, client_id, cost_mode,
 *     freebuff_instance_id? }, provider: { allow_fallbacks } }
 * NOT nested under a `codebuff` object (the backend rejects the nested shape
 * with 400 "No runId found in request body").
 *
 * The run_id is not a free-form uuid: the backend resolves it against its
 * agent-run store and rejects unknown ids with 400 "runId Not Found". So every
 * chat request first registers a run via POST /api/v1/agent-runs
 * ({ action:"START", agentId, ancestorRunIds:[] }) → { runId }, and that id is
 * what goes in codebuff_metadata.run_id. The free tier additionally gates on a
 * session: POST /api/v1/freebuff/session with an `x-freebuff-model` header
 * claims a row (bound to one model, ~1h); its instance id must ride along as
 * codebuff_metadata.freebuff_instance_id.
 */
const SESSION_PATH = "/api/v1/freebuff/session";
const RUN_PATH = "/api/v1/agent-runs";
const SESSION_DEFAULT_TTL_MS = 60 * 60 * 1000;

const SESSION_STALE_CODES = new Set([428, 409, 410]);

const FREEBUFF_SYSTEM_MARKER = "You are Buffy, the strategic coding assistant.";

const FREEBUFF_ROOT_SYSTEM_OPENINGS = [
  "You are Buffy, the strategic coding assistant.",
  "You are Buffy, the Freebuff Cloud project planner.",
  "You are Buffy, a strategic assistant that orchestrates complex coding tasks through specialized sub-agents.",
];

function injectFreebuffMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return body;
  const first = messages[0];
  if (first?.role === "system" && typeof first.content === "string") {
    const trimmed = first.content.trimStart();
    if (FREEBUFF_ROOT_SYSTEM_OPENINGS.some((opening) => trimmed.startsWith(opening))) return body;
    return {
      ...body,
      messages: [{ ...first, content: `${FREEBUFF_SYSTEM_MARKER}\n\n${first.content}` }, ...messages.slice(1)],
    };
  }
  return { ...body, messages: [{ role: "system", content: FREEBUFF_SYSTEM_MARKER }, ...messages] };
}

const END_TURN_TOOL = {
  type: "function",
  function: {
    name: "end_turn",
    description: "Signal the end of the current task.",
    parameters: { type: "object", properties: {} },
  },
};

function injectEndTurnTool(body) {
  const tools = body?.tools;
  if (!Array.isArray(tools) || tools.length === 0) return body;
  if (tools.some((tool) => tool?.function?.name === "end_turn")) return body;
  return { ...body, tools: [...tools, END_TURN_TOOL] };
}

const FREE_ROOT_AGENT_BY_MODEL = {
  "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base3-free-deepseek",
  "mimo/mimo-v2.5": "base3-free-mimo",
  "minimax/minimax-m3": "base3-free-minimax-m3",
  "openai/gpt-5.6-luna": "base3-free-luna",
};

const FB_STATE_KEY = "__9routerFreebuffState__";
const fbState = (globalThis[FB_STATE_KEY] ??= {
  sessionCache: new Map(),
  inflight: new Map(),
  modelLockCooldowns: new Map(),
  poolLimitCooldowns: new Map(),
});
const sessionCache = fbState.sessionCache;
const inflight = fbState.inflight;
const modelLockCooldowns = fbState.modelLockCooldowns;
const poolLimitCooldowns = fbState.poolLimitCooldowns;

const MODEL_LOCK_COOLDOWN_MS = 10 * 60 * 1000;
const POOL_LIMITED_COOLDOWN_MS = 5 * 60 * 1000;

function setCooldown(map, key, until) {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v <= now) map.delete(k);
  }
  map.set(key, until);
}

function getCooldown(map, key) {
  const until = map.get(key);
  if (until == null) return null;
  if (until <= Date.now()) {
    map.delete(key);
    return null;
  }
  return until;
}

function proxyKeyOf(proxyOptions) {
  return proxyOptions?.vercelRelayUrl || proxyOptions?.connectionProxyUrl || "direct";
}

function sessionGateFromText(text) {
  let parsed = {};
  try { parsed = JSON.parse(String(text || "")); } catch { parsed = {}; }
  return classifySessionGate(parsed.error || parsed.error_type || "", parsed.message || "", parsed.currentModel || null);
}

function sessionGateFromError(error) {
  const msg = String(error?.message || "");
  const start = msg.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(msg.slice(start));
    return classifySessionGate(parsed.error || "", parsed.message || "", parsed.currentModel || null);
  } catch {
    return null;
  }
}

function classifySessionGate(code, message, currentModel) {
  if (code === "session_superseded") return { kind: "superseded" };
  if (code === "model_locked") return { kind: "model_locked", currentModel };
  if (code === "session_model_mismatch") {
    return /limited/i.test(String(message || ""))
      ? { kind: "limited_ip" }
      : { kind: "model_locked", currentModel };
  }
  return { kind: "stale" };
}

async function throwSessionGateError(gate, { token, model, proxyKey, poolId, log }) {
  if (gate.kind === "model_locked") {
    const until = Date.now() + MODEL_LOCK_COOLDOWN_MS;
    setCooldown(modelLockCooldowns, `${token}::${model}`, until);
    const label = gate.currentModel ? `"${gate.currentModel}"` : "another model";
    const err = new Error(
      `Freebuff session is locked to ${label} — it cannot serve ${model}. End the session on freebuff.com or wait for it to expire (~1h).`,
    );
    err.status = 409;
    err.resetsAtMs = until;
    log?.warn?.("AUTH", `Freebuff model_locked (session=${label}, requested=${model}) — model cooldown ${MODEL_LOCK_COOLDOWN_MS / 60000}min`);
    throw err;
  }
  if (gate.kind === "limited_ip") {
    const until = Date.now() + POOL_LIMITED_COOLDOWN_MS;
    setCooldown(poolLimitCooldowns, `${proxyKey}::${model}`, until);
    const scope = `freebuff::${model}`;
    if (poolId) await markPoolUnfit(poolId, scope, until, "limited_ip");
    const err = new Error(
      `Freebuff limited-mode IP rejected ${model} — this IP only allows DeepSeek V4 Flash / MiMo 2.5. Use a full-access proxy or a different model.`,
    );
    err.status = 409;
    err.poolScoped = { poolId, scope, reason: "limited_ip" };
    log?.warn?.("AUTH", `Freebuff limited-IP refused ${model} (proxy=${proxyKey.slice(0, 40)}…) — cooldown ${POOL_LIMITED_COOLDOWN_MS / 60000}min`);
    throw err;
  }
}

function sessionOrigin() {
  return new URL(PROVIDERS.freebuff.baseUrl).origin;
}

function sessionCacheKey(token, model) {
  return `${token}::${model}`;
}

function rootAgentIdForModel(model) {
  return FREE_ROOT_AGENT_BY_MODEL[model] || "base2-free";
}

async function fetchWithNetworkRetry(url, options, proxyOptions, attempts = 3, timeoutMs = FETCH_CONNECT_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const opts = { ...options, signal: AbortSignal.timeout(timeoutMs) };
      return await proxyAwareFetch(url, opts, proxyOptions);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  }
  throw lastError;
}

async function requestSession(token, model, proxyOptions) {
  const response = await fetchWithNetworkRetry(`${sessionOrigin()}${SESSION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "codebuff-cli/0.0.138",
      "x-freebuff-model": model,
    },
  }, proxyOptions);

  let data = {};
  try { data = await response.json(); } catch { data = {}; }

  if (response.status === 401) {
    const err = new Error("Freebuff session auth failed (401) — re-login in the dashboard");
    err.status = 401;
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`Freebuff session request failed: ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
    err.status = response.status;
    throw err;
  }

  const status = data?.status;
  if (status === "active") {
    const parsedExp = Date.parse(data.expiresAt || "");
    const entry = {
      instanceId: data.instanceId,
      expiresAt: Number.isFinite(parsedExp) ? parsedExp : Date.now() + SESSION_DEFAULT_TTL_MS,
    };
    sessionCache.set(sessionCacheKey(token, model), entry);
    return { instanceId: data.instanceId, status: "active" };
  }
  if (status === "none") {
    return { instanceId: null, status: "none" };
  }

  const GATE_MESSAGES = {
    country_blocked: "Freebuff is not available in your region (country blocked).",
    banned: "Your Freebuff account has been banned.",
    ip_capped: "Freebuff IP cap reached — try again later.",
    rate_limited: "Freebuff session limit reached for this model — try again later.",
    spend_limited: "Freebuff spend limit reached — add credits or wait for the window to reset.",
    model_locked: "Freebuff session is locked to another model — end it in the CLI or wait for it to expire.",
    model_unavailable: "This model is not available on Freebuff right now.",
    premium_slot_taken: "Freebuff premium slot is taken — try another model.",
  };
  if (GATE_MESSAGES[status]) {
    const message = data?.message ? `${GATE_MESSAGES[status]} ${data.message}` : GATE_MESSAGES[status];
    throw new Error(message);
  }
  throw new Error(`Freebuff session rejected (${status || response.status}): ${JSON.stringify(data).slice(0, 200)}`);
}

async function ensureSession(token, model, proxyOptions, force = false) {
  const key = sessionCacheKey(token, model);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt <= Date.now()) {
    sessionCache.delete(key);
  }
  if (!force && cached && cached.expiresAt > Date.now()) {
    return { instanceId: cached.instanceId, status: "active" };
  }
  if (force) {
    sessionCache.delete(key);
    inflight.delete(key);
    return requestSession(token, model, proxyOptions);
  }
  if (!inflight.has(key)) {
    inflight.set(key, requestSession(token, model, proxyOptions).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

async function startRun(token, model, proxyOptions) {
  const response = await fetchWithNetworkRetry(`${sessionOrigin()}${RUN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "codebuff-cli/0.0.138",
    },
    body: JSON.stringify({
      action: "START",
      agentId: rootAgentIdForModel(model),
      ancestorRunIds: [],
    }),
  }, proxyOptions);

  const text = await response.text().catch(() => "");
  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }

  if (response.status === 401) {
    const err = new Error("Freebuff run auth failed (401) — re-login in the dashboard");
    err.status = 401;
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`Freebuff run start failed: ${response.status} ${text.slice(0, 200)}`);
    err.status = response.status;
    throw err;
  }
  if (!data?.runId) {
    throw new Error(`Freebuff run start returned no runId: ${text.slice(0, 200)}`);
  }
  return data.runId;
}

async function finishRun(token, runId, status, proxyOptions) {
  if (!runId) return;
  try {
    await proxyAwareFetch(`${sessionOrigin()}${RUN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "codebuff-cli/0.0.138",
      },
      body: JSON.stringify({ action: "FINISH", runId, status }),
      signal: AbortSignal.timeout(10_000),
    }, proxyOptions);
  } catch {
    // Best-effort only
  }
}

export function resetSessionCache() {
  sessionCache.clear();
  inflight.clear();
}

export function sessionStateSize() {
  return {
    sessions: sessionCache.size,
    inflight: inflight.size,
    modelLocks: modelLockCooldowns.size,
    poolLimits: poolLimitCooldowns.size,
  };
}

export function pruneSessionState(now = Date.now()) {
  let removed = 0;
  for (const [key, entry] of sessionCache) {
    if (entry?.expiresAt && entry.expiresAt <= now) {
      sessionCache.delete(key);
      removed += 1;
    }
  }
  for (const [key, until] of modelLockCooldowns) {
    if (until <= now) {
      modelLockCooldowns.delete(key);
      removed += 1;
    }
  }
  for (const [key, until] of poolLimitCooldowns) {
    if (until <= now) {
      poolLimitCooldowns.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS.freebuff);
  }

  buildUrl() {
    return this.config.baseUrl;
  }

  parseError(response, bodyText) {
    const text = String(bodyText || "");
    if (response?.status === 404 && /No endpoints found/i.test(text)) {
      return {
        status: 404,
        message: `Freebuff upstream rejected the request (404: "${text.trim().slice(0, 90)}"). Tool-calling requests need the CLI's end_turn tool — retry; if it persists the Codebuff backend may be having trouble.`,
        resetsAtMs: Date.now() + 120_000,
      };
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model, body, stream, credentials) {
    body.codebuff_metadata = {
      client_id:
        credentials?.providerSpecificData?.fingerprintId ||
        `9router-${crypto.randomUUID()}`,
      cost_mode: "free",
    };
    body.provider = { allow_fallbacks: false };
    delete body.reasoning_effort;
    delete body.reasoning;
    return injectEndTurnTool(injectFreebuffMarker(body));
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const token = credentials?.accessToken;
    if (!token) {
      throw new Error("Freebuff requires a connected Freebuff login (no access token found)");
    }

    const proxyKey = proxyKeyOf(proxyOptions);
    const poolId = proxyOptions?.proxyPoolId || null;
    const scope = `freebuff::${model}`;
    const lockUntil = getCooldown(modelLockCooldowns, `${token}::${model}`);
    if (lockUntil) {
      const err = new Error(`Freebuff session locked to another model — retry after ${new Date(lockUntil).toLocaleTimeString()}`);
      err.status = 409;
      err.resetsAtMs = lockUntil;
      throw err;
    }
    const poolUntil = getCooldown(poolLimitCooldowns, `${proxyKey}::${model}`);
    if (poolUntil) {
      const err = new Error(`Freebuff limited-mode IP rejected ${model} — retry with a full-access proxy after ${new Date(poolUntil).toLocaleTimeString()}`);
      err.status = 409;
      err.poolScoped = { poolId, scope, reason: "limited_ip" };
      throw err;
    }

    let session;
    try {
      session = await ensureSession(token, model, proxyOptions);
    } catch (error) {
      const gate = sessionGateFromError(error);
      if (gate) await throwSessionGateError(gate, { token, model, proxyKey, poolId, log });
      log?.error?.("AUTH", `Freebuff session failed: ${error.message}`);
      throw error;
    }

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    let runId = null;
    const traceSessionId = crypto.randomUUID();

    const buildBody = () => {
      const transformed = this.transformRequest(model, body, stream, credentials);
      transformed.codebuff_metadata.run_id = runId;
      transformed.codebuff_metadata.trace_session_id = traceSessionId;
      if (session?.instanceId) {
        transformed.codebuff_metadata.freebuff_instance_id = session.instanceId;
      }
      return transformed;
    };

    const doChat = async () => {
      let networkAttempts = 0;
      const MAX_NETWORK_ATTEMPTS = 2;
      for (let attempt = 0; ; attempt++) {
        const transformedBody = buildBody();
        const bodyStr = JSON.stringify(transformedBody);

        const connectCtrl = new AbortController();
        const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
        const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
        const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;
        let response;
        try {
          response = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal: mergedSignal }, proxyOptions);
        } catch (error) {
          const aborted = error?.name === "AbortError";
          if (aborted || networkAttempts >= MAX_NETWORK_ATTEMPTS) throw error;
          networkAttempts += 1;
          log?.debug?.("RETRY", `network error on ${url} (${error.message}), retry ${networkAttempts}/${MAX_NETWORK_ATTEMPTS}`);
          await new Promise((resolve) => setTimeout(resolve, 750));
          continue;
        } finally {
          clearTimeout(connectTimer);
        }

        const entry = resolveRetryEntry(retryConfig[response.status]);
        if (entry && attempt < entry.attempts) {
          log?.debug?.("RETRY", `${response.status} on ${url}, retry ${attempt + 1}/${entry.attempts} after ${entry.delayMs / 1000}s`);
          await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
          continue;
        }
        return { response, transformedBody };
      }
    };

    let activeRunId = null;
    const markFinished = (status) => {
      if (!activeRunId) return;
      const id = activeRunId;
      activeRunId = null;
      finishRun(token, id, status, proxyOptions);
    };

    try {
      try {
        runId = await startRun(token, model, proxyOptions);
        activeRunId = runId;
      } catch (error) {
        log?.error?.("AUTH", `Freebuff run start failed: ${error.message}`);
        throw error;
      }

      let { response, transformedBody } = await doChat();

      if (SESSION_STALE_CODES.has(response.status)) {
        const text = await response.text().catch(() => "");
        const gate = sessionGateFromText(text);
        if (gate.kind === "model_locked" || gate.kind === "limited_ip") {
          markFinished("cancelled");
          await throwSessionGateError(gate, { token, model, proxyKey, poolId, log });
        }

        log?.debug?.("AUTH", `Freebuff ${response.status} session gate — re-claiming session`);
        markFinished("cancelled");
        try {
          session = await ensureSession(token, model, proxyOptions, true);
          runId = await startRun(token, model, proxyOptions);
          activeRunId = runId;
        } catch (error) {
          const gate2 = sessionGateFromError(error);
          if (gate2) await throwSessionGateError(gate2, { token, model, proxyKey, poolId, log });
          log?.error?.("AUTH", `Freebuff session re-claim failed: ${error.message}`);
          throw error;
        }
        ({ response, transformedBody } = await doChat());

        if (SESSION_STALE_CODES.has(response.status)) {
          const text2 = await response.text().catch(() => "");
          const gate3 = sessionGateFromText(text2);
          if (gate3.kind === "model_locked" || gate3.kind === "limited_ip") {
            await throwSessionGateError(gate3, { token, model, proxyKey, poolId, log });
          }
          const err = new Error(
            `Freebuff session gate refused (${response.status}) — another freebuff instance may be holding the session. ${text2.slice(0, 160)}`,
          );
          err.status = response.status;
          throw err;
        }
      }

      if (response.ok) {
        modelLockCooldowns.delete(`${token}::${model}`);
        poolLimitCooldowns.delete(`${proxyKey}::${model}`);
        if (poolId) await clearPoolUnfit(poolId, scope);
      }

      if (response.status === 401) {
        sessionCache.delete(sessionCacheKey(token, model));
        const text = await response.text().catch(() => "");
        const err = new Error(`Freebuff auth failed (401) — re-login in the dashboard. ${text.slice(0, 120)}`);
        err.status = 401;
        throw err;
      }

      markFinished(response.ok ? "completed" : "failed");

      return { response, url, headers, transformedBody };
    } finally {
      if (activeRunId) {
        finishRun(token, activeRunId, "failed", proxyOptions);
      }
    }
  }
}

export const __test__ = {
  ensureSession,
  requestSession,
  startRun,
  resetSessionCache,
  rootAgentIdForModel,
  injectFreebuffMarker,
  injectEndTurnTool,
  fetchWithNetworkRetry,
  FREEBUFF_SYSTEM_MARKER,
  SESSION_STALE_CODES,
};

export default FreebuffExecutor;

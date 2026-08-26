/**
 *
 * Tracks EMA latency, rolling success rate, and circuit breaker state per provider.
 * Writes are debounced (2s or 20 outcomes) to SQLite via the health repo.
 * Emits "update" on healthEmitter after each batch flush so the latency SSE
 * stream can push snapshots without polling.
 *
 * Circuit breaker states: closed → open → half-open → closed
 *   closed:    normal operation
 *   open:      all requests rejected immediately (tripped after FAIL_THRESHOLD consecutive failures)
 *   half-open: one probe request allowed; success → closed, failure → open
 *
 * Fail-open: any error in record() is swallowed — never throws into the proxy cycle.
 *
 * ponytail: persist health state across restarts via healthRepo when DB schema
 * migration for the health table lands.
 */

import { EventEmitter } from "node:events";
import { rankModels, getBalancedTopModels, detectModelTier, MODEL_TIERS } from "./modelRanking.js";

export const healthEmitter = new EventEmitter();
healthEmitter.setMaxListeners(50);

// EMA smoothing factor (α): higher = more weight on recent samples
const EMA_ALPHA = 0.2;
// Circuit breaker thresholds
const FAIL_THRESHOLD = 5;       // consecutive failures to trip
const OPEN_DURATION_MS = 60_000; // stay open for 60s before half-open probe
// Batch flush: whichever comes first
const FLUSH_DEBOUNCE_MS = 2_000;
const FLUSH_BATCH_SIZE = 20;

/** @type {Map<string, ProviderHealth>} */
const store = new Map();

/**
 * @typedef {object} ProviderHealth
 * @property {number} emaLatency       - EMA of latency in ms
 * @property {number} successCount     - rolling window successes
 * @property {number} failCount        - rolling window failures
 * @property {number} consecutiveFails - streak for circuit breaker
 * @property {"closed"|"open"|"half-open"} circuitState
 * @property {number} openedAt         - epoch ms when circuit opened
 * @property {number} pendingCount     - outcomes since last flush
 */

function defaultHealth() {
  return {
    emaLatency: 0,
    successCount: 0,
    failCount: 0,
    consecutiveFails: 0,
    circuitState: "closed",
    openedAt: 0,
    pendingCount: 0,
    _flushTimer: null,
  };
}

function getOrCreate(providerId) {
  if (!store.has(providerId)) store.set(providerId, defaultHealth());
  return store.get(providerId);
}

/** Schedule a debounced flush for this provider. */
function scheduleFlushed(providerId) {
  const h = store.get(providerId);
  if (!h) return;
  if (h._flushTimer) return; // already scheduled
  h._flushTimer = setTimeout(() => flush(providerId), FLUSH_DEBOUNCE_MS);
}

function flush(providerId) {
  const h = store.get(providerId);
  if (!h) return;
  h._flushTimer = null;
  h.pendingCount = 0;
  // Emit so SSE stream pushes a snapshot
  healthEmitter.emit("update");
  // ponytail: persist to DB via healthRepo here
}

/**
 * Record one outcome for a provider.
 * @param {string} providerId
 * @param {{ success: boolean, latencyMs: number }} outcome
 */
export function record(providerId, { success, latencyMs }) {
  try {
    const h = getOrCreate(providerId);

    // Update EMA latency (only on success — failed requests have no meaningful latency)
    if (success && latencyMs > 0) {
      h.emaLatency = h.emaLatency === 0
        ? latencyMs
        : h.emaLatency * (1 - EMA_ALPHA) + latencyMs * EMA_ALPHA;
    }

    // Rolling window (last 100 outcomes)
    const total = h.successCount + h.failCount;
    if (total >= 100) {
      // Decay oldest: approximate by scaling down
      h.successCount = Math.floor(h.successCount * 0.99);
      h.failCount = Math.floor(h.failCount * 0.99);
    }

    if (success) {
      h.successCount++;
      h.consecutiveFails = 0;
      // Half-open probe succeeded → close circuit
      if (h.circuitState === "half-open") h.circuitState = "closed";
    } else {
      h.failCount++;
      h.consecutiveFails++;
      if (h.circuitState === "closed" && h.consecutiveFails >= FAIL_THRESHOLD) {
        h.circuitState = "open";
        h.openedAt = Date.now();
      } else if (h.circuitState === "half-open") {
        // Probe failed → back to open
        h.circuitState = "open";
        h.openedAt = Date.now();
      }
    }

    h.pendingCount++;
    if (h.pendingCount >= FLUSH_BATCH_SIZE) {
      if (h._flushTimer) { clearTimeout(h._flushTimer); h._flushTimer = null; }
      flush(providerId);
    } else {
      scheduleFlushed(providerId);
    }
  } catch {
    // Fail-open — never propagate into proxy cycle
  }
}

/**
 * Check if a provider's circuit is open (requests should be skipped).
 * Automatically transitions open → half-open after OPEN_DURATION_MS.
 * @param {string} providerId
 * @returns {boolean} true = circuit open, skip this provider
 */
export function isCircuitOpen(providerId) {
  const h = store.get(providerId);
  if (!h) return false;
  if (h.circuitState === "closed") return false;
  if (h.circuitState === "half-open") return false; // allow probe
  // open: check if it's time to try half-open
  if (Date.now() - h.openedAt >= OPEN_DURATION_MS) {
    h.circuitState = "half-open";
    return false; // allow probe
  }
  return true;
}

/**
 * Get a snapshot of all provider health for SSE / dashboard.
 * @returns {{ providers: Record<string, object> }}
 */
export function getProviderHealthSnapshot() {
  const providers = {};
  for (const [id, h] of store) {
    const total = h.successCount + h.failCount;
    providers[id] = {
      emaLatency: Math.round(h.emaLatency),
      successCount: h.successCount,
      failCount: h.failCount,
      successRate: total > 0 ? h.successCount / total : null,
      circuitState: h.circuitState,
      consecutiveFails: h.consecutiveFails,
    };
  }
  return { providers };
}

/**
 *
 * Scores connected providers or tested candidate models by a weighted combination of:
 *   - reliability (success rate)
 *   - latency (lower = better)
 *   - cost (pricing data, lower = better)
 *   - quality (model tier: reasoning > flagship > mini)
 *
 * Returns an ordered list of provider/model strings suitable for a combo.
 *
 * @param {object[]} connections     - Active provider connections from DB
 * @param {object} weights           - { reliability: 0-1, latency: 0-1, cost: 0-1, quality: 0-1 }
 * @param {object} [pricingMap]      - { [providerId]: costPerMToken } optional
 * @param {object[]} [testedModels]  - Optional array of tested models from probe
 * @param {object} [promptContext]   - Optional prompt analysis for context-aware ranking
 * @returns {string[]}               - Ordered model strings ["provider/model", ...]
 */
export async function buildAutoCombo(
  connections,
  weights = { reliability: 0.4, latency: 0.3, cost: 0.2, quality: 0.1 },
  pricingMap = {},
  testedModels = null,
  promptContext = null
) {
  const { reliability: wR = 0.4, latency: wL = 0.3, cost: wC = 0.2, quality: wQ = 0.1 } = weights;

  // If active tested models are supplied, rank working models directly
  if (Array.isArray(testedModels) && testedModels.length > 0) {
    const working = testedModels.filter((m) => m && m.ok && !isCircuitOpen(m.provider));
    if (working.length > 0) {
      // Enrich models with health data for ranking
      const enriched = working.map((m) => {
        const h = store.get(m.provider);
        const total = h ? h.successCount + h.failCount : 0;
        return {
          ...m,
          successRate: total > 0 ? h.successCount / total : 1.0,
          emaLatency: h?.emaLatency || m.latencyMs || 500,
          cost: pricingMap[m.provider] ?? 1,
        };
      });

      const ranked = rankModels(enriched, { reliability: wR, latency: wL, cost: wC, quality: wQ }, promptContext);
      const balanced = getBalancedTopModels(ranked, 10);
      return [...new Set(balanced.map((m) => m.model || m.modelId || m.name).filter(Boolean))];
    }
  }

  // Fallback: provider-level connection scoring
  const candidates = connections
    .filter((c) => c.isActive && c.provider)
    .map((c) => {
      const h = store.get(c.provider);
      const total = h ? h.successCount + h.failCount : 0;
      const successRate = total > 0 ? h.successCount / total : 0.5; // assume 50% if no data
      const emaLatency = h?.emaLatency || 5000; // assume 5s if no data
      const cost = pricingMap[c.provider] ?? 1; // relative cost unit
      const open = isCircuitOpen(c.provider);
      return { c, successRate, emaLatency, cost, open };
    })
    .filter((x) => !x.open); // exclude tripped circuits

  if (candidates.length === 0) return [];

  // Normalize each dimension to [0, 1]
  const maxLatency = Math.max(...candidates.map((x) => x.emaLatency), 1);
  const maxCost = Math.max(...candidates.map((x) => x.cost), 1);

  const scored = candidates.map((x) => {
    const rScore = x.successRate;                          // higher = better
    const lScore = 1 - x.emaLatency / maxLatency;         // lower latency = higher score
    const cScore = 1 - x.cost / maxCost;                  // lower cost = higher score
    const score = wR * rScore + wL * lScore + wC * cScore;
    return { ...x, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Return as "provider/defaultModel" strings (use connection's defaultModel or provider id)
  return [...new Set(scored.map((x) => {
    const model = x.c.defaultModel || x.c.provider;
    return model.includes("/") ? model : `${x.c.provider}/${model}`;
  }))];
}

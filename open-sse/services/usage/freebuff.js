/**
 * Freebuff usage handler
 *
 * Freebuff has no separate billing/quota API — the daily free/premium session
 * quota lives on the session endpoint itself. Reading it MUST use
 * GET /api/v1/freebuff/session (the CLI's status poll): POST would CLAIM a
 * session and burn 1.0 unit of the daily quota, which a quota tracker must
 * never do.
 *
 * The GET response carries the shared session quota as `rateLimitsByModel`,
 * keyed by model id, on the pre-join (`none`), `active`, and `ended` states:
 *   { limit, recentCount, resetAt, period: 'pacific_day'|'pacific_week',
 *     resetTimeZone, entitlementBreakdown? }
 * `recentCount` is fractional — a long agent run can consume 1.3 units — and
 * includes the active session's own 1.0-unit reservation. `limit` can be
 * raised by referral/streak rewards (entitlementBreakdown.base + referral +
 * streak).
 */

import REGISTRY from "../../providers/registry/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

// Friendly labels from the registry model list (mirrors the CLI picker).
const freebuffRegistry = REGISTRY.find((r) => r.id === "freebuff") || {};
const MODEL_LABELS = Object.fromEntries(
  (freebuffRegistry.models || []).map((m) => [m.id, m.name]),
);

const SESSION_TIMEOUT_MS = 15000;

function sessionUrl() {
  return U("freebuff").url;
}

export async function getFreebuffUsage(accessToken, _providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Freebuff credential not available — connect a Freebuff login first." };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    const response = await proxyAwareFetch(
      sessionUrl(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "codebuff-cli/0.0.138",
          Accept: "application/json",
        },
        signal: controller.signal,
      },
      proxyOptions,
    );
    clearTimeout(timeoutId);

    if (response.status === 401) {
      return { message: "Freebuff credential invalid or expired — re-login in the dashboard." };
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => ({}));
      if (body?.status === "country_blocked") {
        return { message: "Freebuff is not available in your region." };
      }
      if (body?.status === "banned") {
        return { message: "Your Freebuff account has been banned." };
      }
      return {
        message: `Freebuff quota access denied (403)${body?.message ? `: ${body.message}` : ""}.`,
      };
    }
    if (response.status === 404) {
      return { plan: "Freebuff", message: "Freebuff connected. No session quota to report right now." };
    }
    if (!response.ok) {
      return { message: `Freebuff quota API error (${response.status}).` };
    }

    const data = await response.json().catch(() => ({}));
    const rateLimits = { ...(data.rateLimitsByModel || {}) };
    if (data.status === "active" && data.rateLimit && !rateLimits[data.model]) {
      rateLimits[data.model] = data.rateLimit;
    }

    const quotas = {};
    for (const [model, rl] of Object.entries(rateLimits)) {
      if (!rl || typeof rl !== "object") continue;
      const used = Number(rl.recentCount);
      const total = Number(rl.limit);
      quotas[model] = {
        used: Number.isFinite(used) ? used : 0,
        total: Number.isFinite(total) ? total : 0,
        resetAt: rl.resetAt || null,
        unlimited: false,
        recurring: true,
        ...(MODEL_LABELS[model] ? { displayName: MODEL_LABELS[model] } : {}),
      };
    }

    // Surface API model IDs the registry doesn't know about. The Freebuff
    // backend sometimes reports models the picker doesn't list (or vice versa);
    // logging them here makes drift visible without filtering the response.
    const known = new Set(Object.keys(MODEL_LABELS));
    const unknown = Object.keys(rateLimits).filter((m) => !known.has(m));
    if (unknown.length > 0) {
      console.log(
        `[freebuff-usage] ${unknown.length} model(s) reported by API but absent from registry:`,
        unknown.join(", "),
      );
    }

    const plan = data.accessTier === "limited" ? "Freebuff (Limited)" : "Freebuff";
    if (Object.keys(quotas).length === 0) {
      return { plan, message: "Freebuff connected. No session quota to report right now." };
    }
    return { plan, quotas };
  } catch (error) {
    return { message: `Freebuff usage error: ${error.message}` };
  }
}

export default getFreebuffUsage;

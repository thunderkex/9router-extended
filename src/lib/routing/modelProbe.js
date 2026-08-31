import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { record } from "@/lib/routing/health";
import { getCustomModels, getDisabledModels } from "@/lib/localDb";

/**
 * In-memory cache for tested models to avoid burning tokens on repeated queries.
 * Key: "provider/modelId"
 * Value: { ok, latencyMs, status, error, timestamp, provider, name, model }
 */
const probeCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

/**
 * Clear cached test results (optionally for a specific provider).
 */
export function clearProbeCache(providerId = null) {
  if (!providerId) {
    probeCache.clear();
    return;
  }
  for (const [key, value] of probeCache.entries()) {
    if (value.provider === providerId || key.startsWith(`${providerId}/`)) {
      probeCache.delete(key);
    }
  }
}

/**
 * Retrieve current snapshot of cached probe results.
 */
export function getCachedProbeResults() {
  const now = Date.now();
  const valid = [];
  for (const [key, item] of probeCache.entries()) {
    if (now - item.timestamp <= CACHE_TTL_MS) {
      valid.push({ ...item, key });
    }
  }
  return valid;
}

/**
 * Resolve candidate models for a given provider connection.
 * Returns custom models, registry models, or connection models minus disabled ones.
 */
export function resolveConnectionModels(connection, { customModels = null, disabledModels = null } = {}) {
  if (!connection || !connection.provider) return [];
  const providerId = connection.provider;
  const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
  const alias = (
    connection?.providerSpecificData?.prefix
    || (isCompatible ? providerId : null)
    || PROVIDER_ID_TO_ALIAS[providerId]
    || providerId
  ).trim();

  if (!customModels) {
    try {
      const res = getCustomModels();
      customModels = Array.isArray(res) ? res : [];
    } catch {
      customModels = [];
    }
  }
  if (!disabledModels) {
    try {
      const res = getDisabledModels();
      disabledModels = res && typeof res === "object" ? res : {};
    } catch {
      disabledModels = {};
    }
  }

  const disabledList = Array.isArray(disabledModels[alias])
    ? disabledModels[alias]
    : (Array.isArray(disabledModels[providerId]) ? disabledModels[providerId] : []);
  const isDisabled = (id) => disabledList.includes(id);

  const registryModels = (getProviderModels(alias) || getProviderModels(providerId) || []).filter((m) => !isDisabled(m.id));
  const providerCustomModels = (customModels || []).filter(
    (m) => (m.providerAlias === alias || m.providerAlias === providerId) && !isDisabled(m.id)
  );

  // 1. Explicit connection.models array or providerSpecificData.enabledModels
  const rawModelList = (Array.isArray(connection.models) && connection.models.length > 0)
    ? connection.models
    : (Array.isArray(connection.providerSpecificData?.enabledModels) && connection.providerSpecificData.enabledModels.length > 0
      ? connection.providerSpecificData.enabledModels
      : null);

  if (Array.isArray(rawModelList) && rawModelList.length > 0) {
    const enabledIds = rawModelList.map((m) =>
      typeof m === "string" ? m : m?.id || m?.name
    ).filter(Boolean);

    const candidates = [];
    for (const enabledId of enabledIds) {
      if (isDisabled(enabledId)) continue;
      const registryMatch = registryModels.find((rm) => rm.id === enabledId);
      const customMatch = providerCustomModels.find((cm) => cm.id === enabledId);

      if (registryMatch) {
        candidates.push({
          id: registryMatch.id,
          modelKey: registryMatch.id.includes("/") ? registryMatch.id : `${alias}/${registryMatch.id}`,
          name: registryMatch.name || registryMatch.id,
          kind: registryMatch.kind || registryMatch.type || "llm",
          provider: providerId,
          alias,
        });
      } else if (customMatch) {
        candidates.push({
          id: customMatch.id,
          modelKey: customMatch.id.includes("/") ? customMatch.id : `${alias}/${customMatch.id}`,
          name: customMatch.name || customMatch.id,
          kind: customMatch.type || "llm",
          provider: providerId,
          alias,
        });
      } else {
        const modelKey = enabledId.includes("/") ? enabledId : `${alias}/${enabledId}`;
        candidates.push({
          id: enabledId,
          modelKey,
          name: enabledId,
          kind: "llm",
          provider: providerId,
          alias,
        });
      }
    }
    if (connection.defaultModel && !candidates.some((c) => c.id === connection.defaultModel)) {
      const regDef = registryModels.find((rm) => rm.id === connection.defaultModel);
      candidates.unshift({
        id: connection.defaultModel,
        modelKey: connection.defaultModel.includes("/") ? connection.defaultModel : `${alias}/${connection.defaultModel}`,
        name: regDef?.name || connection.defaultModel,
        kind: "llm",
        provider: providerId,
        alias,
      });
    }
    if (candidates.length > 0) return candidates;
  }

  // 2. Collect all custom models registered for this provider (e.g. openrouter/stealth/ox-alpha)
  const candidates = [];
  for (const cm of providerCustomModels) {
    const modelKey = cm.id.includes("/") ? cm.id : `${alias}/${cm.id}`;
    candidates.push({
      id: cm.id,
      modelKey,
      name: cm.name || cm.id,
      kind: cm.type || "llm",
      provider: providerId,
      alias,
    });
  }

  // 3. Collect registry models
  for (const rm of registryModels) {
    const modelKey = rm.id.includes("/") ? rm.id : `${alias}/${rm.id}`;
    if (!candidates.some((c) => c.modelKey === modelKey)) {
      candidates.push({
        id: rm.id,
        modelKey,
        name: rm.name || rm.id,
        kind: rm.kind || rm.type || "llm",
        provider: providerId,
        alias,
      });
    }
  }

  // 4. Fallback: defaultModel if present and not yet added
  if (connection.defaultModel && !isDisabled(connection.defaultModel)) {
    const defKey = connection.defaultModel.includes("/") ? connection.defaultModel : `${alias}/${connection.defaultModel}`;
    if (!candidates.some((c) => c.modelKey === defKey)) {
      candidates.unshift({
        id: connection.defaultModel,
        modelKey: defKey,
        name: connection.defaultModel,
        kind: "llm",
        provider: providerId,
        alias,
      });
    }
  }

  // Cap candidates per provider (max 5 models) to keep probe times snappy
  return candidates.slice(0, 5);
}

/**
 * Probe a batch of models with concurrency control.
 */
async function runWithConcurrency(tasks, limit = 3) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = Promise.resolve().then(task).then((res) => {
      executing.delete(p);
      return res;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/**
 * Probe all models for a single provider connection with minimal token usage.
 */
export async function probeProviderModels(connection, options = {}) {
  const {
    baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`,
    force = false,
    maxConcurrency = 3,
    timeoutMs = 10000,
    customModels = null,
    disabledModels = null,
  } = options;

  if (!connection || connection.isActive === false) return [];

  const candidateModels = await resolveConnectionModels(connection, { customModels, disabledModels });
  if (candidateModels.length === 0) return [];

  const now = Date.now();
  const toTest = [];
  const results = [];

  for (const item of candidateModels) {
    const cached = probeCache.get(item.modelKey);
    if (!force && cached && now - cached.timestamp < CACHE_TTL_MS) {
      results.push(cached);
    } else {
      toTest.push(item);
    }
  }

  if (toTest.length === 0) {
    return results;
  }

  // Warm up first model first to avoid token refresh race condition
  const [first, ...rest] = toTest;
  const firstRes = await pingModelByKind(first.modelKey, first.kind, baseUrl, timeoutMs);
  const firstEntry = {
    model: first.modelKey,
    modelId: first.id,
    name: first.name,
    provider: first.provider,
    alias: first.alias,
    kind: first.kind,
    ok: firstRes.ok,
    latencyMs: firstRes.latencyMs || 0,
    status: firstRes.status || (firstRes.ok ? 200 : 500),
    error: firstRes.error || null,
    timestamp: Date.now(),
  };

  probeCache.set(first.modelKey, firstEntry);
  record(first.provider, { success: firstRes.ok, latencyMs: firstRes.latencyMs || 0 });
  results.push(firstEntry);

  if (rest.length > 0) {
    const tasks = rest.map((item) => async () => {
      const res = await pingModelByKind(item.modelKey, item.kind, baseUrl, timeoutMs);
      const entry = {
        model: item.modelKey,
        modelId: item.id,
        name: item.name,
        provider: item.provider,
        alias: item.alias,
        kind: item.kind,
        ok: res.ok,
        latencyMs: res.latencyMs || 0,
        status: res.status || (res.ok ? 200 : 500),
        error: res.error || null,
        timestamp: Date.now(),
      };
      probeCache.set(item.modelKey, entry);
      record(item.provider, { success: res.ok, latencyMs: res.latencyMs || 0 });
      return entry;
    });

    const restEntries = await runWithConcurrency(tasks, maxConcurrency);
    results.push(...restEntries);
  }

  return results;
}

/**
 * Probe all models across all active provider connections in parallel.
 */
export async function probeAllActiveConnections(options = {}) {
  const {
    connections = [],
    baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`,
    force = false,
    maxConcurrency = 3,
    timeoutMs = 10000,
  } = options;

  const active = connections.filter((c) => c && c.isActive !== false && c.provider);
  if (active.length === 0) {
    return { testedModels: [], summary: { total: 0, working: 0, failed: 0 } };
  }

  let customModels = [];
  try { customModels = await getCustomModels(); } catch { customModels = []; }

  let disabledModels = {};
  try { disabledModels = await getDisabledModels(); } catch { disabledModels = {}; }

  // Probe all active providers in parallel
  const resultsByProvider = await Promise.all(
    active.map((conn) =>
      probeProviderModels(conn, {
        baseUrl,
        force,
        maxConcurrency,
        timeoutMs,
        customModels,
        disabledModels,
      })
    )
  );

  const allTested = resultsByProvider.flat();
  const working = allTested.filter((m) => m.ok).length;
  const failed = allTested.filter((m) => !m.ok).length;

  return {
    testedModels: allTested,
    summary: {
      total: allTested.length,
      working,
      failed,
    },
  };
}

import { refreshCodexToken } from "./tokenRefresh/providers.js";

const CODEX_CLIENT_VERSION = "0.144.6";
const CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`;

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

const appendCodexReviewModels = (models) =>
  models.flatMap((model) => {
    const id = model?.id || model?.slug || model?.model || model?.name;
    if (!id) return [];
    const name = model?.display_name || model?.displayName || model?.name || id;
    const normalized = { ...model, id, name };
    const isChatModel = (model?.type || "llm") !== "image" && !id.toLowerCase().includes("embed");
    if (!isChatModel || id.endsWith("-review")) return [normalized];
    return [
      normalized,
      {
        ...normalized,
        id: `${id}-review`,
        name: `${name} Review`,
        upstreamModelId: id,
        quotaFamily: "review",
      },
    ];
  });

const parseCodexModels = (data) => appendCodexReviewModels(parseOpenAIStyleModels(data));

const modelCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve live Codex models catalog with token refresh
 * @param {object} credentials - { accessToken, refreshToken, providerSpecificData }
 * @param {object} options - { log, onCredentialsRefreshed }
 * @returns {Promise<{ models: [], rawModels: [] }>}
 */
export async function resolveCodexModels(credentials, options = {}) {
  const { log, onCredentialsRefreshed } = options;
  const cacheKey = credentials.accessToken?.slice(0, 16) || "default";
  
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  let token = credentials.accessToken;

  // Attempt fetch with current token
  let response = await fetch(CODEX_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "originator": "codex_cli_rs"
    }
  });

  // If 401, refresh token and retry
  if (response.status === 401 && credentials.refreshToken) {
    log?.info?.("CODEX_MODELS", "Access token expired, refreshing...");
    const refreshed = await refreshCodexToken(credentials.refreshToken);
    if (refreshed?.accessToken) {
      token = refreshed.accessToken;
      if (onCredentialsRefreshed) {
        await onCredentialsRefreshed(refreshed);
      }
      response = await fetch(CODEX_MODELS_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "originator": "codex_cli_rs"
        }
      });
    }
  }

  if (!response.ok) {
    throw new Error(`Codex models fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rawModels = parseOpenAIStyleModels(data); // Base upstream models (no -review)
  const models = parseCodexModels(data); // Expanded with -review variants
  
  // Debug: log what we got
  log?.info?.("CODEX_MODELS", `Fetched ${rawModels.length} raw models: ${rawModels.map(m => m.id).join(", ")}`);

  const result = { models, rawModels };
  modelCache.set(cacheKey, { data: result, timestamp: Date.now() });
  
  return result;
}

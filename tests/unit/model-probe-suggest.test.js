import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("@/lib/localDb", () => ({
  getApiKeys: vi.fn(async () => [{ key: "test-api-key", isActive: true }]),
}));
vi.mock("@/shared/constants/config", () => ({
  UPDATER_CONFIG: { appPort: 20128 },
}));
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(async () => "cli-token-123"),
}));

const { buildAutoCombo, record } = await import("../../src/lib/routing/health.js");
const {
  resolveConnectionModels,
  probeProviderModels,
  probeAllActiveConnections,
  clearProbeCache,
  getCachedProbeResults,
} = await import("../../src/lib/routing/modelProbe.js");

describe("Model Probe & Tested Auto-Combo Suggestions", () => {
  let fetchMock;

  beforeEach(() => {
    clearProbeCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(obj, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(obj),
      json: async () => obj,
    };
  }

  it("resolves connection models from registry and custom definitions", () => {
    const conn = {
      provider: "openai",
      isActive: true,
      defaultModel: "gpt-4o",
      models: [{ id: "gpt-4o-custom", name: "Custom GPT-4o" }],
    };
    const resolved = resolveConnectionModels(conn);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.some((m) => m.id === "gpt-4o")).toBe(true);
    expect(resolved.some((m) => m.id === "gpt-4o-custom")).toBe(true);
  });

  it("probes provider models with minimal token request and records latency", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
      if (body.model.includes("working-model")) {
        return jsonResponse({ choices: [{ message: { content: "1" } }] });
      }
      return jsonResponse({ error: { message: "Model not found" } }, 404);
    });

    const conn = {
      provider: "mock-prov",
      isActive: true,
      models: [
        { id: "working-model", name: "Working Model" },
        { id: "failing-model", name: "Failing Model" },
      ],
    };

    const results = await probeProviderModels(conn, { baseUrl: "http://127.0.0.1:20128", force: true });
    expect(results.length).toBe(2);

    const working = results.find((r) => r.modelId === "working-model");
    const failing = results.find((r) => r.modelId === "failing-model");

    expect(working?.ok).toBe(true);
    expect(failing?.ok).toBe(false);
    expect(failing?.status).toBe(404);
  });

  it("buildAutoCombo strictly filters out failing models and ranks working models by latency and weights", () => {
    const tested = [
      {
        model: "provider-a/fast-model",
        provider: "provider-a",
        ok: true,
        latencyMs: 120,
      },
      {
        model: "provider-b/slow-model",
        provider: "provider-b",
        ok: true,
        latencyMs: 850,
      },
      {
        model: "provider-c/broken-model",
        provider: "provider-c",
        ok: false,
        latencyMs: 50,
        status: 500,
      },
    ];

    const connections = [
      { provider: "provider-a", isActive: true },
      { provider: "provider-b", isActive: true },
      { provider: "provider-c", isActive: true },
    ];

    const combo = buildAutoCombo(
      connections,
      { reliability: 0.4, latency: 0.5, cost: 0.1 },
      {},
      tested
    );

    // Broken model must be completely excluded
    expect(combo).not.toContain("provider-c/broken-model");
    // Fast model should be ranked higher than slow model
    expect(combo[0]).toBe("provider-a/fast-model");
    expect(combo[1]).toBe("provider-b/slow-model");
  });

  it("caches probe results and avoids re-probing unless forced", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

    const conn = {
      provider: "cache-prov",
      isActive: true,
      models: [{ id: "model-1", name: "Model 1" }],
    };

    await probeProviderModels(conn, { baseUrl: "http://127.0.0.1:20128", force: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call without force should hit memory cache
    await probeProviderModels(conn, { baseUrl: "http://127.0.0.1:20128", force: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Call with force=true should re-probe
    await probeProviderModels(conn, { baseUrl: "http://127.0.0.1:20128", force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

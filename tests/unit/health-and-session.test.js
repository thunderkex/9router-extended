import { describe, it, expect } from "vitest";
import { record, isCircuitOpen, getProviderHealthSnapshot, buildAutoCombo } from "../../src/lib/routing/health.js";
import { getSession, setSession, incrementFailover, invalidateSkillSet } from "../../src/lib/session/cache.js";

describe("Routing Health & Circuit Breaker", () => {
  it("records success and keeps circuit closed", () => {
    record("openai", { success: true, latencyMs: 150 });
    expect(isCircuitOpen("openai")).toBe(false);
  });

  it("trips circuit breaker after consecutive failures threshold", () => {
    for (let i = 0; i < 5; i++) {
      record("mock-provider", { success: false, latencyMs: 1000 });
    }
    expect(isCircuitOpen("mock-provider")).toBe(true);
    const snapshot = getProviderHealthSnapshot();
    expect(snapshot.providers["mock-provider"]?.circuitState).toBe("open");
  });

  it("buildAutoCombo filters out open circuit providers and ranks by score", () => {
    const connections = [
      { provider: "fast-provider", isActive: true, defaultModel: "fast-provider/model-a" },
      { provider: "mock-provider", isActive: true, defaultModel: "mock-provider/model-b" },
    ];
    const combo = buildAutoCombo(connections, { reliability: 0.5, latency: 0.3, cost: 0.2 });
    expect(combo).toContain("fast-provider/model-a");
    expect(combo).not.toContain("mock-provider/model-b");
  });
});

describe("Session State & LRU Cache", () => {
  it("stores and retrieves session metadata", () => {
    setSession("sess-1", { skillSetHash: "hash-abc", compiledPromptHash: "prompt-123" });
    const meta = getSession("sess-1");
    expect(meta).toBeDefined();
    expect(meta.skillSetHash).toBe("hash-abc");
    expect(meta.compiledPromptHash).toBe("prompt-123");
  });

  it("increments failoverCount", () => {
    incrementFailover("sess-2");
    incrementFailover("sess-2");
    const meta = getSession("sess-2");
    expect(meta.failoverCount).toBe(2);
  });

  it("invalidates by skillSetHash", () => {
    setSession("sess-3", { skillSetHash: "target-hash", compiledPromptHash: "p1" });
    setSession("sess-4", { skillSetHash: "other-hash", compiledPromptHash: "p2" });
    invalidateSkillSet("target-hash");
    expect(getSession("sess-3").compiledPromptHash).toBe("");
    expect(getSession("sess-4").compiledPromptHash).toBe("p2");
  });
});

import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";
import mitmConfig from "../../src/mitm/config.js";
import { isValidModel, getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("Gemini 4 Argon Support & Config", () => {
  it("registers gemini-4-argon in antigravity provider registry", () => {
    const agIds = antigravityRegistry.models.map((m) => m.id);
    expect(agIds).toContain("gemini-4-argon");
  });

  it("registers gemini-4-argon in gemini provider registry", () => {
    const geminiIds = geminiRegistry.models.map((m) => m.id);
    expect(geminiIds).toContain("gemini-4-argon");
  });

  it("resolves capabilities correctly for gemini-4-argon", () => {
    const caps = getCapabilitiesForModel("antigravity", "gemini-4-argon");
    expect(caps.vision).toBe(true);
    expect(caps.audioInput).toBe(true);
    expect(caps.videoInput).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.search).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
  });

  it("defines pricing for gemini-4-argon", () => {
    expect(MODEL_PRICING["gemini-4-argon"]).toEqual({
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00,
    });
    expect(getPricingForModel("antigravity", "gemini-4-argon")).toMatchObject({
      input: 2.00,
      output: 12.00,
    });
  });

  it("includes gemini-4-argon in Antigravity MITM configuration", () => {
    const ag = MITM_TOOLS.antigravity;
    expect(ag.modelAliases).toContain("gemini-4-argon");
    expect(ag.defaultModels.some((m) => m.id === "gemini-4-argon")).toBe(true);

    expect(mitmConfig.MODEL_SYNONYMS.antigravity["gemini-4-argon"]).toBe("gemini-4-argon");

    const matchModel = (raw) => {
      for (const { match, alias } of mitmConfig.MODEL_PATTERNS.antigravity) {
        if (match.test(raw)) return alias;
      }
      return null;
    };
    expect(matchModel("gemini-4-argon")).toBe("gemini-4-argon");
  });

  it("validates model lookup and thinking levels via open-sse", () => {
    expect(isValidModel("ag", "gemini-4-argon")).toBe(true);
    expect(getModelsByProviderId("antigravity").some((m) => m.id === "gemini-4-argon")).toBe(true);
    expect(getModelsByProviderId("ag").some((m) => m.id === "gemini-4-argon")).toBe(true);

    const levels = getThinkingLevels("antigravity", "gemini-4-argon");
    expect(levels).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("transforms request cleanly through AntigravityExecutor with thinking", () => {
    const executor = new AntigravityExecutor();
    const body = {
      model: "gemini-4-argon",
      request: {
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: {},
      },
    };

    applyThinking("antigravity", "gemini-4-argon(high)", body, "antigravity");
    const result = executor.transformRequest("gemini-4-argon", body, true, {
      projectId: "test-project",
      connectionId: "conn-123",
    });

    expect(result.model).toBe("gemini-4-argon");
    expect(result.project).toBe("test-project");
    expect(result.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "high",
      includeThoughts: true,
    });
    expect(result.request.contents).toEqual([
      { role: "user", parts: [{ text: "ping" }] },
    ]);
  });
});

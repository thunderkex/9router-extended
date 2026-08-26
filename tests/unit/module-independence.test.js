import { describe, it, expect } from "vitest";
import { trimRequestBody } from "../../src/lib/tokensaver/trim.js";
import { dedupParagraphs } from "../../src/lib/tokensaver/dedup-prompt.js";
import { dispatchHook } from "../../src/lib/skillsRegistry.js";
import { record, isCircuitOpen, buildAutoCombo } from "../../src/lib/routing/health.js";

describe("Module Independence & Zero-Dependency Core", () => {
  it("request body is unchanged when all token savers are disabled", () => {
    const originalBody = {
      messages: [
        { role: "system", content: "System instructions" },
        { role: "user", content: "Hello world" }
      ],
      model: "openai/gpt-4o"
    };
    const bodyCopy = JSON.parse(JSON.stringify(originalBody));

    // Token trimmer disabled (enabled = false)
    const trimmed = trimRequestBody(bodyCopy, 80000, false);
    expect(trimmed).toEqual(originalBody);

    // Dedup prompt disabled (returns raw input when not processed)
    const rawPrompt = "Line 1\n\nLine 2";
    expect(dedupParagraphs(rawPrompt)).toBe(rawPrompt);
  });

  it("dispatchHook passes through unmodified payload when no skills are enabled", async () => {
    const payload = { messages: [{ role: "user", content: "Test message" }] };
    const result = await dispatchHook("pre-route", [], payload, {});
    expect(result).toEqual(payload);
  });

  it("health tracking and combo fallback operate independently of community modules", () => {
    record("independent-provider", { success: true, latencyMs: 100 });
    expect(isCircuitOpen("independent-provider")).toBe(false);

    const connections = [
      { provider: "independent-provider", isActive: true, defaultModel: "independent-provider/gpt-4o" }
    ];
    const combo = buildAutoCombo(connections);
    expect(combo).toEqual(["independent-provider/gpt-4o"]);
  });
});

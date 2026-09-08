import { describe, it, expect, vi } from "vitest";
import { classifyRequest, injectPlan } from "../../src/lib/autoPlanRouter.js";

describe("Auto Plan-Then-Code Flow and Fail-Open", () => {
  it("fails open gracefully when smart classification throws or fails", async () => {
    const mockChatThrow = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const messages = [
      { role: "user", content: "build full auth service with database and tokens across modules" }
    ];
    
    // Heuristic will trigger and smart classify won't crash
    const res = await classifyRequest(messages, {
      autoPlanSmartClassify: true,
      autoPlanComplexityThreshold: 6
    }, {
      handleSingleModelChat: mockChatThrow
    });

    expect(res).toBeDefined();
    expect(res.needsPlan).toBe(true);
  });

  it("fails open to Tier 1 when LLM response is not ok", async () => {
    const mockChatNotOk = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const messages = [
      { role: "user", content: "build application" }
    ];

    const res = await classifyRequest(messages, {
      autoPlanSmartClassify: true,
      autoPlanComplexityThreshold: 6
    }, {
      handleSingleModelChat: mockChatNotOk
    });

    expect(res).toBeDefined();
  });

  it("preserves conversation turns and formats plan context correctly", () => {
    const messages = [
      { role: "system", content: "base prompt" },
      { role: "user", content: "first turn" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second turn" }
    ];
    const planText = "<PLAN>\n1. Touch auth.js\n</PLAN>";
    const augmented = injectPlan(messages, planText);

    expect(augmented.length).toBe(5);
    expect(augmented[3].role).toBe("system");
    expect(augmented[3].content).toContain(planText);
    expect(augmented[4].content).toBe("second turn");
  });
});

import { describe, it, expect } from "vitest";
import {
  classifyHeuristic,
  injectPlan,
  stripPlanMarkersForClient,
  resolvePlanCombo,
  resolveCodeCombo
} from "../../src/lib/autoPlanRouter.js";

describe("Auto Plan-Then-Code Heuristic Classifier", () => {
  it("should return needsPlan=false for simple questions and short fixes", () => {
    const res1 = classifyHeuristic([
      { role: "user", content: "kenapa error ini muncul?" }
    ]);
    expect(res1.needsPlan).toBe(false);

    const res2 = classifyHeuristic([
      { role: "user", content: "fix typo di baris 12" }
    ]);
    expect(res2.needsPlan).toBe(false);

    const res3 = classifyHeuristic([
      { role: "user", content: "what is the difference between let and const?" }
    ]);
    expect(res3.needsPlan).toBe(false);
  });

  it("should return needsPlan=false if conversation already has <PLAN>", () => {
    const res = classifyHeuristic([
      { role: "assistant", content: "<PLAN>\n1. Setup auth\n</PLAN>" },
      { role: "user", content: "Sekarang implementasikan kode authentication database dan microservice secara end-to-end multi file" }
    ]);
    expect(res.needsPlan).toBe(false);
    expect(res.reason).toBe("already_planned");
  });

  it("should return needsPlan=false for agent tool-call loops", () => {
    const res = classifyHeuristic([
      { role: "user", content: "build application" },
      { role: "assistant", tool_calls: [{ function: { name: "readFile" } }] },
      { role: "tool", content: "file content" }
    ]);
    expect(res.needsPlan).toBe(false);
    expect(res.reason).toBe("agent_tool_loop");
  });

  it("should return needsPlan=true for complex multi-scope build requests", () => {
    const res1 = classifyHeuristic([
      {
        role: "user",
        content: "buatkan aplikasi todo list dengan auth, database, dan API across multiple files and backend"
      }
    ]);
    expect(res1.needsPlan).toBe(true);

    const res2 = classifyHeuristic([
      {
        role: "user",
        content: "refactor seluruh modul payment jadi microservice dengan architecture baru menyentuh beberapa file dan database"
      }
    ]);
    expect(res2.needsPlan).toBe(true);
  });

  it("correctly injects plan into messages array", () => {
    const messages = [
      { role: "system", content: "You are an assistant" },
      { role: "user", content: "build full auth" }
    ];
    const augmented = injectPlan(messages, "<PLAN>\n1. Step A\n</PLAN>");
    expect(augmented.length).toBe(3);
    expect(augmented[1].role).toBe("system");
    expect(augmented[1].content).toContain("<PLAN>\n1. Step A\n</PLAN>");
    expect(augmented[2].content).toBe("build full auth");
  });

  it("correctly strips plan markers", () => {
    const raw = "<PLAN>\nStep 1\n</PLAN>\nHere is the code:\n```js\nconsole.log(1);\n```";
    const stripped = stripPlanMarkersForClient(raw);
    expect(stripped).toBe("Here is the code:\n```js\nconsole.log(1);\n```");
  });

  it("resolves combos according to auto and manual modes", () => {
    const combos = [
      { id: "c1", name: "free-mix", models: ["gemini-1.5-flash", "gemma"] },
      { id: "c2", name: "claude-vip", models: ["anthropic/claude-3-5-sonnet-20241022"] }
    ];

    // Auto mode picks combo containing claude
    const plan = resolvePlanCombo(combos, { autoPlanMode: "auto" });
    expect(plan.name).toBe("claude-vip");

    // Manual mode picks specified combo
    const manualPlan = resolvePlanCombo(combos, { autoPlanMode: "manual", autoPlanComboId: "c1" });
    expect(manualPlan.id).toBe("c1");

    // Code combo resolves correctly
    const code = resolveCodeCombo(combos, { autoPlanMode: "manual", autoCodeComboId: "c1" });
    expect(code.id).toBe("c1");
  });
});

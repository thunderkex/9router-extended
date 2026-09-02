import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyPrompt,
  tokenize,
  extractUserQuery,
  formatSkillInjection,
  clearSkillIndexCache,
  loadSkillPrompt,
  getSkillIndex,
} from "../../src/skills/autoRouter.js";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("ECC Auto Skill Router Full Test Suite", () => {
  beforeEach(() => {
    clearSkillIndexCache();
  });

  describe("Catalog & Indexing", () => {
    it("loads catalog with all 286 ECC skills", async () => {
      const index = await getSkillIndex();
      expect(index.skills.length).toBe(286);
      expect(index.docVectors.length).toBe(286);
    });

    it("loads prompt.md content for a valid skill", async () => {
      const prompt = await loadSkillPrompt("docker-patterns");
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(50);
    });
  });

  describe("Tokenization & Query Extraction", () => {
    it("tokenizes and stems words properly without stop words", () => {
      const tokens = tokenize("testing and writing docker compose files!");
      expect(tokens).toContain("docker");
      expect(tokens).toContain("compose");
      expect(tokens).not.toContain("and");
    });

    it("extracts last user query from OpenAI messages array", () => {
      const openAIBody = {
        messages: [
          { role: "system", content: "You are an assistant" },
          { role: "user", content: "first question" },
          { role: "assistant", content: "first answer" },
          { role: "user", content: "write playwright e2e tests" },
        ],
      };
      expect(extractUserQuery(openAIBody)).toBe("write playwright e2e tests");
    });

    it("extracts last user query from Claude / OpenAI structured parts", () => {
      const structuredBody = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "create a redis kubernetes deployment" },
            ],
          },
        ],
      };
      expect(extractUserQuery(structuredBody)).toBe("create a redis kubernetes deployment");
    });

    it("extracts last user query from Gemini contents format", () => {
      const geminiBody = {
        contents: [
          { role: "user", parts: [{ text: "help me with docker setup" }] },
        ],
      };
      expect(extractUserQuery(geminiBody)).toBe("help me with docker setup");
    });
  });

  describe("Classification & Thresholds", () => {
    it("correctly routes TDD/E2E prompt to testing skill", async () => {
      const results = await classifyPrompt("write a failing test first for this auth flow", {
        threshold: 0.3,
        maxSkills: 1,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toMatch(/test|tdd|e2e/i);
      expect(results[0].score).toBeGreaterThanOrEqual(0.3);
    });

    it("correctly routes docker prompt to docker-patterns", async () => {
      const results = await classifyPrompt("set up a docker compose file for redis and postgres", {
        threshold: 0.35,
        maxSkills: 1,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("docker-patterns");
    });

    it("returns empty array for trivial arithmetic or greetings", async () => {
      const mathResults = await classifyPrompt("what is 2+2", { threshold: 0.35 });
      expect(mathResults).toEqual([]);

      const greetResults = await classifyPrompt("hello", { threshold: 0.35 });
      expect(greetResults).toEqual([]);
    });

    it("allows adjusting confidence threshold dynamically (strict vs permissive)", async () => {
      const query = "review and optimize database indexes for postgresql";
      
      // Low threshold allows match
      const looseResults = await classifyPrompt(query, { threshold: 0.1, maxSkills: 2 });
      expect(looseResults.length).toBeGreaterThan(0);

      // Super strict threshold filters out weaker matches
      const strictResults = await classifyPrompt(query, { threshold: 0.95, maxSkills: 2 });
      expect(strictResults.length).toBeLessThan(looseResults.length);
    });

    it("respects maxSkills limit (1 vs 3)", async () => {
      const query = "docker container orchestration and kubernetes microservices";
      
      const single = await classifyPrompt(query, { threshold: 0.1, maxSkills: 1 });
      expect(single.length).toBe(1);

      const triple = await classifyPrompt(query, { threshold: 0.1, maxSkills: 3 });
      expect(triple.length).toBeGreaterThanOrEqual(1);
      expect(triple.length).toBeLessThanOrEqual(3);
    });
  });

  describe("System Prompt Injection", () => {
    it("formats skill injection with banner tags and score", () => {
      const skill = { name: "docker-patterns", score: 0.85 };
      const promptContent = "Always use multi-stage builds.";
      const formatted = formatSkillInjection(skill, promptContent);
      expect(formatted).toContain("--- ECC Skill: docker-patterns (auto-selected, confidence 0.85) ---");
      expect(formatted).toContain("Always use multi-stage builds.");
      expect(formatted).toContain("--- End ECC Skill ---");
    });

    it("injects formatted prompt into OpenAI system messages", () => {
      const body = {
        messages: [{ role: "user", content: "make a dockerfile" }],
      };
      const prompt = "--- ECC Skill: docker-patterns ---\nTip\n--- End ECC Skill ---";
      injectSystemPrompt(body, FORMATS.OPENAI, prompt);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("ECC Skill: docker-patterns");
    });

    it("injects formatted prompt into Claude system block", () => {
      const body = {
        system: "Existing system prompt",
        messages: [{ role: "user", content: "make a dockerfile" }],
      };
      const prompt = "--- ECC Skill: docker-patterns ---\nTip\n--- End ECC Skill ---";
      injectSystemPrompt(body, FORMATS.CLAUDE, prompt);
      expect(body.system).toContain("Existing system prompt");
      expect(body.system).toContain("ECC Skill: docker-patterns");
    });
  });
});

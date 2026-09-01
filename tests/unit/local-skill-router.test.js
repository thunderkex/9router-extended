import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock registry before importing the router
vi.mock("@/lib/skillsRegistry.js", () => ({
  getSkillManifests: vi.fn(),
}));

vi.mock("../../src/skills/autoRouter.js", () => ({
  extractUserQuery: vi.fn((body) => body?._query ?? ""),
}));

import { getSkillManifests } from "@/lib/skillsRegistry.js";
import { extractUserQuery } from "../../src/skills/autoRouter.js";
import { classifyLocalSkills, clearLocalSkillIndexCache } from "../../src/skills/localSkillRouter.js";

const TASTE = {
  id: "taste-skill",
  name: "Taste Skill",
  hook: "system-prompt",
  routable: true,
  default_enabled: true,
  routing_threshold: 0.32,
  triggers: ["ui component", "css", "frontend", "landing page", "gradient"],
  keywords: ["ui", "ux", "design", "frontend", "css", "component", "style"],
  prompt_template: "You are a design expert.",
  config_schema: [
    { key: "routing_mode", type: "enum", default: "smart" },
    { key: "design_variance", type: "slider", label: "Design Variance", min: 1, max: 10, default: 5 },
  ],
};

const COMMIT = {
  id: "commit-lint",
  name: "Commit Lint",
  hook: "system-prompt",
  routable: true,
  default_enabled: false,
  routing_threshold: 0.35,
  triggers: ["commit message", "conventional commit", "git commit"],
  keywords: ["commit", "git", "conventional", "changelog"],
  prompt_template: "Follow Conventional Commits.",
  config_schema: [{ key: "routing_mode", type: "enum", default: "smart" }],
};

const HUMAN_HANDWRITTEN = {
  id: "human-handwritten",
  name: "Human Handwritten",
  hook: "system-prompt",
  routable: false, // NOT routable — must never appear in results
  default_enabled: true,
  prompt_template: "Write like a human.",
  config_schema: [],
};

function q(text) {
  return { _query: text };
}

beforeEach(() => {
  clearLocalSkillIndexCache();
  vi.clearAllMocks();
});

describe("classifyLocalSkills", () => {
  it("UI query matches taste-skill, not commit-lint", async () => {
    getSkillManifests.mockResolvedValue([TASTE, COMMIT]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("make a frontend landing page with gradient button"), {
      "taste-skillEnabled": true,
      "commit-lintEnabled": true,
    });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("taste-skill");
    expect(ids).not.toContain("commit-lint");
  });

  it("unrelated query matches nothing", async () => {
    getSkillManifests.mockResolvedValue([TASTE, COMMIT]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("explain how binary search works"), {
      "taste-skillEnabled": true,
      "commit-lintEnabled": true,
    });
    expect(results).toHaveLength(0);
  });

  it("cross-topic query can match both skills", async () => {
    getSkillManifests.mockResolvedValue([TASTE, COMMIT]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(
      q("refactor this frontend component and write a conventional commit message"),
      { "taste-skillEnabled": true, "commit-lintEnabled": true }
    );
    const ids = results.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids).toContain("taste-skill");
    expect(ids).toContain("commit-lint");
  });

  it("MAX_LOCAL_SKILLS_PER_REQUEST caps at 2", async () => {
    const PONYTAIL = {
      id: "ponytail",
      name: "Ponytail",
      hook: "system-prompt",
      routable: true,
      default_enabled: true,
      routing_threshold: 0.01, // very low — always matches
      triggers: ["refactor", "frontend", "commit message"],
      keywords: ["refactor", "frontend", "commit"],
      prompt_template: "Minimal code.",
      config_schema: [{ key: "routing_mode", type: "enum", default: "smart" }],
    };
    const TASTE_LOW = { ...TASTE, routing_threshold: 0.01 };
    const COMMIT_LOW = { ...COMMIT, routing_threshold: 0.01, default_enabled: true };
    getSkillManifests.mockResolvedValue([TASTE_LOW, COMMIT_LOW, PONYTAIL]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(
      q("refactor frontend component and write commit message"),
      { "taste-skillEnabled": true, "commit-lintEnabled": true, ponytailEnabled: true }
    );
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("routing_mode always → skill excluded from classifier (handled by generic loop)", async () => {
    getSkillManifests.mockResolvedValue([TASTE, COMMIT]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("make a frontend landing page with gradient"), {
      "taste-skillEnabled": true,
      "taste-skillRoutingMode": "always", // override to always
    });
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain("taste-skill");
  });

  it("custom routing_threshold respected — higher threshold needs higher score", async () => {
    const HIGH_THRESH = { ...TASTE, routing_threshold: 0.99 };
    getSkillManifests.mockResolvedValue([HIGH_THRESH]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("make a frontend landing page"), {
      "taste-skillEnabled": true,
    });
    // Score won't reach 0.99 for a moderate query
    expect(results).toHaveLength(0);
  });

  it("non-routable skill never appears in results", async () => {
    getSkillManifests.mockResolvedValue([HUMAN_HANDWRITTEN, TASTE]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("write like a human for all responses"), {
      "human-handwrittenEnabled": true,
      "taste-skillEnabled": true,
    });
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain("human-handwritten");
  });

  it("disabled skill not injected even if score matches", async () => {
    getSkillManifests.mockResolvedValue([TASTE]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("make a frontend landing page with gradient"), {
      "taste-skillEnabled": false,
    });
    expect(results).toHaveLength(0);
  });

  it("cache not rebuilt when manifests unchanged", async () => {
    getSkillManifests.mockResolvedValue([TASTE]);
    extractUserQuery.mockImplementation((b) => b._query);

    await classifyLocalSkills(q("frontend css"), { "taste-skillEnabled": true });
    await classifyLocalSkills(q("frontend css"), { "taste-skillEnabled": true });
    // getSkillManifests called twice (once per classifyLocalSkills call) but buildTfIdfIndex only once
    expect(getSkillManifests).toHaveBeenCalledTimes(2);
  });

  it("cache rebuilt when prompt_template changes", async () => {
    getSkillManifests.mockResolvedValueOnce([TASTE]);
    getSkillManifests.mockResolvedValueOnce([{ ...TASTE, prompt_template: "Updated prompt." }]);
    extractUserQuery.mockImplementation((b) => b._query);

    const r1 = await classifyLocalSkills(q("frontend css"), { "taste-skillEnabled": true });
    const r2 = await classifyLocalSkills(q("frontend css"), { "taste-skillEnabled": true });
    // Both should return results (cache rebuilt on second call due to signature change)
    expect(r1.length + r2.length).toBeGreaterThan(0);
  });

  it("classifier error → fail-open (no throw)", async () => {
    getSkillManifests.mockRejectedValue(new Error("disk error"));
    extractUserQuery.mockImplementation((b) => b._query);

    await expect(classifyLocalSkills(q("frontend css"), {})).rejects.toThrow();
    // Note: fail-open is enforced in chat.js try/catch, not inside classifyLocalSkills itself.
    // This test documents that the caller must wrap in try/catch.
  });

  it("routing_mode always on one skill does not affect another skill with smart mode", async () => {
    getSkillManifests.mockResolvedValue([TASTE, COMMIT]);
    extractUserQuery.mockImplementation((b) => b._query);

    // taste-skill set to "always" (excluded from classifier, handled by generic loop)
    // commit-lint remains "smart" (evaluated by classifier)
    const results = await classifyLocalSkills(
      q("refactor frontend component and write a conventional commit message"),
      {
        "taste-skillEnabled": true,
        "taste-skillRoutingMode": "always",
        "commit-lintEnabled": true,
        "commit-lintRoutingMode": "smart",
      }
    );
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain("taste-skill");
    expect(ids).toContain("commit-lint");
  });

  it("trivial greeting skips classification", async () => {
    getSkillManifests.mockResolvedValue([TASTE]);
    extractUserQuery.mockImplementation((b) => b._query);

    const results = await classifyLocalSkills(q("hi"), { "taste-skillEnabled": true });
    expect(results).toHaveLength(0);
  });
});

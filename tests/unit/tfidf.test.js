import { describe, it, expect } from "vitest";
import { tokenize, buildTfIdfIndex, scoreQuery } from "../../src/skills/tfidf.js";

const DOCS = [
  {
    id: "taste-skill",
    name: "Taste Skill",
    description: "Frontend design-taste & anti-AI-slop UI standards",
    triggers: ["ui component", "css", "frontend", "landing page", "gradient"],
    keywords: ["ui", "ux", "design", "frontend", "css", "component", "style", "aesthetic"],
  },
  {
    id: "commit-lint",
    name: "Commit Lint",
    description: "Enforces Conventional Commits format",
    triggers: ["commit message", "conventional commit", "git commit", "changelog"],
    keywords: ["commit", "git", "conventional", "changelog", "versioning"],
  },
  {
    id: "ponytail",
    name: "Ponytail",
    description: "Bias toward minimal code: YAGNI, stdlib, deletion over addition",
    triggers: ["refactor", "simplify", "minimal code", "yagni", "clean up"],
    keywords: ["refactor", "simplify", "minimal", "yagni", "delete", "remove"],
  },
];

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    const tokens = tokenize("Hello, World!");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
  });

  it("filters stop words", () => {
    const tokens = tokenize("the quick brown fox");
    expect(tokens).not.toContain("the");
    expect(tokens).toContain("quick");
  });

  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe("buildTfIdfIndex", () => {
  it("returns empty index for empty docs", () => {
    const idx = buildTfIdfIndex([]);
    expect(idx.docVectors).toHaveLength(0);
    expect(idx.numDocs).toBe(0);
  });

  it("builds vectors for all docs", () => {
    const idx = buildTfIdfIndex(DOCS);
    expect(idx.docVectors).toHaveLength(3);
    expect(idx.numDocs).toBe(3);
  });

  it("doc vectors are L2-normalized (norm ≈ 1)", () => {
    const idx = buildTfIdfIndex(DOCS);
    for (const doc of idx.docVectors) {
      const norm = Math.sqrt(Object.values(doc.vector).reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1, 5);
    }
  });
});

describe("scoreQuery", () => {
  const idx = buildTfIdfIndex(DOCS);

  it("UI query matches taste-skill, not commit-lint", () => {
    const results = scoreQuery(idx, "make a frontend landing page with gradient button", { threshold: 0.1 });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("taste-skill");
    expect(ids).not.toContain("commit-lint");
  });

  it("commit query matches commit-lint, not taste-skill", () => {
    const results = scoreQuery(idx, "write a conventional commit message for this fix", { threshold: 0.1 });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("commit-lint");
    expect(ids).not.toContain("taste-skill");
  });

  it("unrelated query matches nothing above threshold 0.35", () => {
    const results = scoreQuery(idx, "explain how binary search works", { threshold: 0.35 });
    expect(results).toHaveLength(0);
  });

  it("cross-topic query can match multiple skills", () => {
    const results = scoreQuery(idx, "refactor this frontend component and write a commit message", { threshold: 0.1 });
    const ids = results.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("results sorted by score descending", () => {
    const results = scoreQuery(idx, "css frontend ui component design", { threshold: 0.01 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("maxSkills limits output", () => {
    const results = scoreQuery(idx, "refactor frontend commit", { threshold: 0.01, maxSkills: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("returns [] for empty index", () => {
    const empty = buildTfIdfIndex([]);
    expect(scoreQuery(empty, "anything")).toEqual([]);
  });

  it("trigger phrase boost fires for exact trigger substring", () => {
    // "commit message" is a trigger for commit-lint (>3 chars)
    const withTrigger = scoreQuery(idx, "write commit message", { threshold: 0.01 });
    const withoutTrigger = scoreQuery(idx, "write git note", { threshold: 0.01 });
    const commitWithTrigger = withTrigger.find((r) => r.id === "commit-lint");
    const commitWithout = withoutTrigger.find((r) => r.id === "commit-lint");
    if (commitWithTrigger && commitWithout) {
      expect(commitWithTrigger.score).toBeGreaterThan(commitWithout.score);
    }
  });
});

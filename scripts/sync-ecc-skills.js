#!/usr/bin/env node

/**
 * scripts/sync-ecc-skills.js
 *
 * Syncs ECC skills (skills/<skill-id>/SKILL.md) from affaan-m/ECC repository.
 * Supports:
 *   --source <path>   Local clone or directory containing skills/
 *   --tag <tag>       Git branch/tag to sync from (default: main)
 *   --force           Overwrite manually edited skills
 *
 * Emits:
 *   skills/ecc-imported/<skill-id>/manifest.json
 *   skills/ecc-imported/<skill-id>/prompt.md
 *   skills/ecc-imported/_index.json
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

const OFFICIAL_REPO = "https://github.com/affaan-m/everything-claude-code.git";
const REPO_OWNER = "affaan-m";
const REPO_NAME = "everything-claude-code";
const DEFAULT_BRANCH = "main";

// Parse CLI args
const args = process.argv.slice(2);
let sourcePath = null;
let gitTag = DEFAULT_BRANCH;
let forceOverwrite = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--source" && args[i + 1]) {
    sourcePath = path.resolve(process.cwd(), args[i + 1]);
    i++;
  } else if (args[i] === "--tag" && args[i + 1]) {
    gitTag = args[i + 1];
    i++;
  } else if (args[i] === "--force") {
    forceOverwrite = true;
  }
}

function computeHash(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Stem/lemmatize common English word endings for improved matching
 */
export function stemWord(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  if (w.endsWith("ment") && w.length > 6) return w.slice(0, -4);
  if (w.endsWith("tion") && w.length > 6) return w.slice(0, -4);
  return w;
}

/**
 * Parse frontmatter and markdown body from SKILL.md
 */
export function parseSkillMarkdown(rawContent) {
  let name = "";
  let description = "";
  let argumentHint = "";
  let body = rawContent;

  const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) {
    const fmText = fmMatch[1];
    body = fmMatch[2].trim();

    const nameMatch = fmText.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

    // Multi-line or single-line description
    const descMatch = fmText.match(/^description:\s*([|>]-?)?\s*\r?\n?([\s\S]*?)(?=^\w[\w-]*:|$)/m);
    if (descMatch) {
      if (descMatch[2]) {
        description = descMatch[2]
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ")
          .trim();
      } else if (descMatch[1]) {
        description = descMatch[1].trim();
      }
    } else {
      const singleDesc = fmText.match(/^description:\s*(.+)$/m);
      if (singleDesc) description = singleDesc[1].trim().replace(/^["']|["']$/g, "");
    }

    const argMatch = fmText.match(/^argument-hint:\s*(.+)$/m);
    if (argMatch) argumentHint = argMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  return { name, description, argumentHint, body };
}

/**
 * Extract keywords & trigger phrases from frontmatter, name, description, and body.
 */
export function deriveKeywords(skillId, name, description, body = "") {
  // Extract activation triggers / sections from body if present
  let bodyTriggers = [];
  const whenSectionMatch = body.match(/##\s*When to Activate[\s\S]*?(?=##|$)/i);
  if (whenSectionMatch) {
    const bulletLines = whenSectionMatch[0]
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"))
      .map((l) => l.replace(/^[-*]\s*/, "").trim().toLowerCase())
      .filter((l) => l.length > 3 && l.length < 80);
    bodyTriggers.push(...bulletLines);
  }

  // Also look for markdown headings in the body
  const headingMatches = (body.match(/^#+\s+(.+)$/gm) || [])
    .map((h) => h.replace(/^#+\s+/, "").trim().toLowerCase())
    .filter((h) => h.length > 3 && h.length < 60 && !h.includes("when to activate"));

  bodyTriggers.push(...headingMatches);

  const textToScan = `${skillId.replace(/[-_]/g, " ")} ${name} ${description} ${body.slice(0, 1000)}`.toLowerCase();
  const rawWords = textToScan
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_]+/)
    .filter((w) => w.length > 2);

  const stopWords = new Set([
    "this", "that", "with", "from", "when", "your", "have", "more", "will", "into",
    "using", "used", "then", "such", "than", "must", "only", "also", "some", "like",
    "skill", "skills", "agent", "rules", "rule", "help", "helps", "about", "provide",
    "provides", "enforce", "enforces", "ensure", "ensures", "should", "could", "would",
    "over", "under", "code", "guidelines", "standards", "practices", "best", "workflow",
    "section", "following", "include", "including", "across", "other", "where", "which"
  ]);

  const uniqueWords = new Set();
  for (const w of rawWords) {
    if (!stopWords.has(w) && !/^\d+$/.test(w)) {
      uniqueWords.add(w);
      const stemmed = stemWord(w);
      if (stemmed.length > 2) uniqueWords.add(stemmed);
    }
  }

  // Base triggers
  const triggers = [];
  if (name) triggers.push(name.toLowerCase());
  if (skillId) {
    triggers.push(skillId.replace(/[-_]/g, " ").toLowerCase());
    triggers.push(skillId.toLowerCase());
  }

  // Extract key trigger phrases from description (e.g. "test-driven development", "security review", "docker compose")
  const phraseMatches = description.match(/(?:[A-Za-z0-9_-]+\s+){1,3}[A-Za-z0-9_-]+/g) || [];
  for (const p of phraseMatches.slice(0, 5)) {
    const cleanP = p.trim().toLowerCase();
    if (cleanP.length > 4 && !triggers.includes(cleanP)) {
      triggers.push(cleanP);
    }
  }

  for (const bt of bodyTriggers) {
    if (!triggers.includes(bt)) triggers.push(bt);
  }

  return {
    keywords: Array.from(uniqueWords),
    triggers: Array.from(new Set(triggers)),
  };
}

async function getSkillsFromLocalSource(dirPath) {
  const skillsDir = fsSync.existsSync(path.join(dirPath, "skills"))
    ? path.join(dirPath, "skills")
    : dirPath;

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
      if (fsSync.existsSync(skillFile)) {
        const content = await fs.readFile(skillFile, "utf8");
        results.push({ skillId: entry.name, content });
      }
    }
  }
  return results;
}

async function getSkillsViaGitClone() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecc-sync-"));
  try {
    console.log(`Cloning official ECC repo from ${OFFICIAL_REPO} (tag/branch: ${gitTag})...`);
    await execAsync(`git clone --depth 1 --branch ${gitTag} ${OFFICIAL_REPO} "${tempDir}"`, {
      timeout: 60000,
    });
    return await getSkillsFromLocalSource(tempDir);
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function getSkillsViaGitHubApi() {
  console.log(`Fetching ECC skills tree from GitHub API (${REPO_OWNER}/${REPO_NAME})...`);
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${gitTag}?recursive=1`;
  const res = await fetch(treeUrl, {
    headers: { "User-Agent": "9Router-ECC-Sync" },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const skillNodes = (data.tree || []).filter(
    (item) => item.path && item.path.startsWith("skills/") && item.path.endsWith("SKILL.md")
  );

  console.log(`Discovered ${skillNodes.length} skills. Fetching contents in parallel...`);
  const results = [];
  const BATCH_SIZE = 15;

  for (let i = 0; i < skillNodes.length; i += BATCH_SIZE) {
    const batch = skillNodes.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (node) => {
        const parts = node.path.split("/");
        const skillId = parts[1];
        const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${gitTag}/${node.path}`;
        try {
          const rawRes = await fetch(rawUrl, {
            headers: { "User-Agent": "9Router-ECC-Sync" },
          });
          if (rawRes.ok) {
            const content = await rawRes.text();
            return { skillId, content };
          }
        } catch (e) {
          console.warn(`Failed to fetch ${node.path}:`, e.message);
        }
        return null;
      })
    );
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

export async function syncEccSkills(options = {}) {
  const src = options.sourcePath || sourcePath;
  const tag = options.gitTag || gitTag;
  const force = options.forceOverwrite ?? forceOverwrite;
  const baseDir = options.targetDir || path.join(process.cwd(), "skills", "ecc-imported");

  let rawSkills = [];

  if (src) {
    console.log(`Reading ECC skills from local source: ${src}`);
    rawSkills = await getSkillsFromLocalSource(src);
  } else {
    try {
      rawSkills = await getSkillsViaGitClone();
    } catch (gitErr) {
      console.warn(`Git clone failed (${gitErr.message}), falling back to GitHub API...`);
      rawSkills = await getSkillsViaGitHubApi();
    }
  }

  if (!rawSkills || rawSkills.length === 0) {
    throw new Error("No ECC skills found to sync.");
  }

  await fs.mkdir(baseDir, { recursive: true });

  const catalog = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let totalCount = 0;

  for (const item of rawSkills) {
    totalCount++;
    const { skillId, content } = item;
    const { name, description, body } = parseSkillMarkdown(content);
    const displayName = name || skillId;
    const { keywords, triggers } = deriveKeywords(skillId, displayName, description, body);

    const skillDir = path.join(baseDir, skillId);
    const manifestPath = path.join(skillDir, "manifest.json");
    const promptPath = path.join(skillDir, "prompt.md");

    const newContentHash = computeHash(body);

    const manifestObj = {
      id: `ecc-${skillId}`,
      name: displayName,
      category: "prompt-injection",
      hook: "system-prompt",
      source: "ecc",
      source_repo: "affaan-m/ECC",
      description: description || `ECC Skill: ${displayName}`,
      keywords,
      triggers,
      content_hash: newContentHash,
      config_schema: [],
    };

    let shouldWrite = true;

    if (!force && fsSync.existsSync(manifestPath) && fsSync.existsSync(promptPath)) {
      try {
        const existingManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        const existingPrompt = await fs.readFile(promptPath, "utf8");
        const existingPromptHash = computeHash(existingPrompt);

        // If user edited the prompt file, existing hash won't match existing recorded hash
        if (
          existingManifest.content_hash &&
          existingPromptHash !== existingManifest.content_hash
        ) {
          console.log(`Skipping locally modified skill: ecc-${skillId}`);
          shouldWrite = false;
          skippedCount++;
        }
      } catch (e) {
        // Parse error, proceed to write
      }
    }

    if (shouldWrite) {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(manifestPath, JSON.stringify(manifestObj, null, 2), "utf8");
      await fs.writeFile(promptPath, body, "utf8");
      updatedCount++;
    }

    catalog.push({
      id: `ecc-${skillId}`,
      folder: skillId,
      name: displayName,
      description: description || `ECC Skill: ${displayName}`,
      keywords,
      triggers,
    });
  }

  // Write _index.json
  const indexPath = path.join(baseDir, "_index.json");
  const catalogPayload = {
    synced_at: new Date().toISOString(),
    source_repo: "affaan-m/ECC",
    total_skills: catalog.length,
    skills: catalog,
  };
  await fs.writeFile(indexPath, JSON.stringify(catalogPayload, null, 2), "utf8");

  console.log(
    `Synced ${catalog.length} ECC skills (${updatedCount} updated, ${skippedCount} skipped user-edited).`
  );

  return {
    success: true,
    total: catalog.length,
    updated: updatedCount,
    skipped: skippedCount,
    synced_at: catalogPayload.synced_at,
  };
}

// Direct execution
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/sync-ecc-skills.js")) {
  syncEccSkills().catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
}

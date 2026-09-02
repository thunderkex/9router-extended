import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { stemWord } from "../../scripts/sync-ecc-skills.js";

// In-memory cache for catalog and TF-IDF index
let cachedCatalog = null;
let cachedTfIdfIndex = null;
let lastIndexMtime = 0;

export const ECC_ROUTER_BYPASS_HEADER = "x-9router-skill-router";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by", "for",
  "with", "about", "against", "between", "into", "through", "during", "before", "after",
  "above", "below", "to", "from", "up", "down", "in", "out", "on", "off", "over", "under",
  "again", "further", "then", "once", "here", "there", "all", "any", "both", "each",
  "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "can", "will", "just", "don", "should", "now",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours",
  "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "what", "which",
  "who", "whom", "this", "that", "these", "those", "am", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing",
  "would", "could", "code", "file", "please", "help", "want", "like", "make", "need"
]);

/**
 * Tokenize input text into normalized & stemmed terms
 */
export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const tokens = [];
  for (const w of words) {
    tokens.push(w);
    const st = stemWord ? stemWord(w) : w;
    if (st && st !== w && st.length > 2) {
      tokens.push(st);
    }
  }
  return tokens;
}

/**
 * Find the skills/ecc-imported directory
 */
async function findEccImportedDir() {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.join(process.cwd(), "skills", "ecc-imported"),
    path.join(__dirname, "..", "..", "skills", "ecc-imported"),
    path.join(__dirname, "..", "skills", "ecc-imported"),
    path.join(process.env.APPDATA || "", "npm", "node_modules", "9router", "cli", "app", "skills", "ecc-imported"),
    path.join(process.env.HOME || "", ".9router", "skills", "ecc-imported"),
  ];

  for (const dir of candidates) {
    try {
      if (fsSync.existsSync(dir)) return dir;
    } catch {}
  }
  return path.join(process.cwd(), "skills", "ecc-imported");
}

/**
 * Build or retrieve TF-IDF document index for the ECC skill catalog
 */
export async function getSkillIndex() {
  const eccDir = await findEccImportedDir();
  const indexPath = path.join(eccDir, "_index.json");

  try {
    const stat = await fs.stat(indexPath);
    if (cachedTfIdfIndex && stat.mtimeMs === lastIndexMtime) {
      return cachedTfIdfIndex;
    }

    const content = await fs.readFile(indexPath, "utf8");
    const data = JSON.parse(content);
    const skills = Array.isArray(data.skills) ? data.skills : [];

    const numDocs = skills.length;
    if (numDocs === 0) {
      return { skills: [], df: {}, docVectors: [], eccDir, numDocs: 0 };
    }

    // Document frequencies
    const df = {};
    const docTokensList = [];

    for (const skill of skills) {
      const idTokens = tokenize(skill.id);
      const nameTokens = tokenize(skill.name);
      const descTokens = tokenize(skill.description);
      const kwTokens = (skill.keywords || []).flatMap((k) => tokenize(k));
      const trigTokens = (skill.triggers || []).flatMap((t) => tokenize(t));

      // Weight: id (5x), name (4x), keywords (3x), triggers (3x), desc (1x)
      const allTokens = [
        ...idTokens, ...idTokens, ...idTokens, ...idTokens, ...idTokens,
        ...nameTokens, ...nameTokens, ...nameTokens, ...nameTokens,
        ...kwTokens, ...kwTokens, ...kwTokens,
        ...trigTokens, ...trigTokens, ...trigTokens,
        ...descTokens,
      ];

      docTokensList.push(allTokens);

      const uniqueInDoc = new Set(allTokens);
      for (const term of uniqueInDoc) {
        df[term] = (df[term] || 0) + 1;
      }
    }

    // Compute TF-IDF vectors for documents
    const docVectors = [];
    for (let i = 0; i < numDocs; i++) {
      const tokens = docTokensList[i];
      const tf = {};
      for (const t of tokens) {
        tf[t] = (tf[t] || 0) + 1;
      }

      const vec = {};
      let sumSq = 0;
      for (const [term, count] of Object.entries(tf)) {
        const idf = Math.log((1 + numDocs) / (1 + (df[term] || 0))) + 1;
        const weight = count * idf;
        vec[term] = weight;
        sumSq += weight * weight;
      }

      const norm = Math.sqrt(sumSq) || 1;
      for (const term of Object.keys(vec)) {
        vec[term] /= norm;
      }

      docVectors.push({
        id: skills[i].id,
        folder: skills[i].folder,
        name: skills[i].name,
        description: skills[i].description,
        triggers: skills[i].triggers || [],
        vector: vec,
      });
    }

    cachedCatalog = data;
    cachedTfIdfIndex = { skills, df, docVectors, eccDir, numDocs };
    lastIndexMtime = stat.mtimeMs;
    return cachedTfIdfIndex;
  } catch (err) {
    return { skills: [], df: {}, docVectors: [], eccDir, numDocs: 0 };
  }
}

/**
 * Extract last user prompt / relevant query string from request body
 */
export function extractUserQuery(body) {
  if (!body) return "";

  // OpenAI chat / Claude format: messages array
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg && (msg.role === "user" || !msg.role)) {
        if (typeof msg.content === "string" && msg.content.trim()) {
          return msg.content.trim();
        } else if (Array.isArray(msg.content)) {
          const text = msg.content
            .filter((p) => p && (p.type === "text" || typeof p === "string"))
            .map((p) => (typeof p === "string" ? p : p.text || ""))
            .join("\n")
            .trim();
          if (text) return text;
        }
      }
    }
  }

  // Gemini contents format
  if (Array.isArray(body.contents) && body.contents.length > 0) {
    for (let i = body.contents.length - 1; i >= 0; i--) {
      const turn = body.contents[i];
      if (turn && turn.role === "user" && Array.isArray(turn.parts)) {
        const text = turn.parts.map((p) => p.text || "").join("\n").trim();
        if (text) return text;
      }
    }
  }

  // OpenAI input / responses format
  if (Array.isArray(body.input) && body.input.length > 0) {
    for (let i = body.input.length - 1; i >= 0; i--) {
      const item = body.input[i];
      if (item && item.role === "user" && typeof item.content === "string" && item.content.trim()) {
        return item.content.trim();
      }
    }
  }

  if (typeof body.prompt === "string") return body.prompt;
  if (typeof body.input === "string") return body.input;

  return "";
}

/**
 * Classify a prompt or request against the ECC catalog using TF-IDF + trigger-overlap.
 *
 * @param {string|object} input - User query string or request body
 * @param {object} options - { threshold: 0.35, maxSkills: 1 }
 * @returns {Promise<Array<{ id: string, name: string, folder: string, score: number, description: string }>>}
 */
export async function classifyPrompt(input, options = {}) {
  const threshold = options.threshold !== undefined ? Number(options.threshold) : 0.35;
  const maxSkills = options.maxSkills !== undefined ? Math.max(1, Number(options.maxSkills)) : 1;

  const queryText = typeof input === "string" ? input : extractUserQuery(input);
  if (!queryText || queryText.trim().length === 0) return [];

  // Short queries / pure trivial greetings or arithmetic should not trigger skills
  const cleanTrimmed = queryText.trim().toLowerCase();
  if (/^(hi|hello|hey|what(?:'s| is) \d+\s*[\+\-\*\/]\s*\d+\??|\d+\s*[\+\-\*\/]\s*\d+)$/i.test(cleanTrimmed)) {
    return [];
  }

  const index = await getSkillIndex();
  if (!index.docVectors || index.docVectors.length === 0) return [];

  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return [];

  const lowerQuery = queryText.toLowerCase();

  // Query vector
  const qTf = {};
  for (const t of queryTokens) {
    qTf[t] = (qTf[t] || 0) + 1;
  }

  const qVec = {};
  let qSumSq = 0;
  for (const [term, count] of Object.entries(qTf)) {
    const idf = Math.log((1 + index.numDocs) / (1 + (index.df[term] || 0))) + 1;
    const weight = count * idf;
    qVec[term] = weight;
    qSumSq += weight * weight;
  }

  const qNorm = Math.sqrt(qSumSq) || 1;
  for (const term of Object.keys(qVec)) {
    qVec[term] /= qNorm;
  }

  // Score documents
  const scored = [];

  for (const doc of index.docVectors) {
    let dot = 0;
    for (const [term, qWeight] of Object.entries(qVec)) {
      if (doc.vector[term]) {
        dot += qWeight * doc.vector[term];
      }
    }

    // Trigger phrase matching: partial word-level overlap
    let triggerBoost = 0;
    const queryWords = new Set(lowerQuery.split(/\s+/).filter(w => w.length > 2));
    for (const trig of doc.triggers) {
      if (!trig || trig.length < 4) continue;
      const trigWords = trig.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const overlap = trigWords.filter(w => queryWords.has(w)).length;
      if (overlap > 0) {
        const overlapRatio = overlap / trigWords.length;
        triggerBoost = Math.max(triggerBoost, overlapRatio * 0.4);
      }
    }

    // Composite query boost: accumulate boosts for each matched domain
    let domainBoost = 0;
    const domainTerms = {
      playwright: ['playwright', 'e2e', 'browser', 'automation', 'test'],
      design: ['design', 'style', 'visual', 'asset', 'component', 'system'],
      prd: ['prd', 'requirement', 'spec', 'document', 'capability', 'product']
    };
    
    const docText = `${doc.name} ${doc.id} ${doc.description}`.toLowerCase();
    for (const [domain, terms] of Object.entries(domainTerms)) {
      const matchCount = terms.filter(t => queryWords.has(t)).length;
      if (matchCount >= 1) {
        const domainRelevance = terms.some(t => docText.includes(t));
        if (domainRelevance) {
          const isExactMatch = doc.name.includes(domain) || doc.id.includes(domain);
          const hasRareKeyword = (domain === 'prd' && queryWords.has('prd') && docText.includes('prd'));
          // Accumulate boosts instead of taking max
          domainBoost += hasRareKeyword ? 0.5 : (isExactMatch ? 0.45 : 0.3);
        }
      }
    }

    const totalScore = Math.min(1.0, dot * 2.2 + triggerBoost + domainBoost);

    if (totalScore >= threshold) {
      scored.push({
        id: doc.id,
        folder: doc.folder,
        name: doc.name,
        description: doc.description,
        score: Math.round(totalScore * 100) / 100,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSkills);
}

/**
 * Load a skill's prompt.md content from disk
 */
export async function loadSkillPrompt(folder) {
  const eccDir = await findEccImportedDir();
  const promptPath = path.join(eccDir, folder, "prompt.md");
  try {
    return await fs.readFile(promptPath, "utf8");
  } catch (err) {
    return "";
  }
}

/**
 * Format injection text for selected skills
 */
export function formatSkillInjection(skill, promptContent) {
  return `--- ECC Skill: ${skill.name} (auto-selected, confidence ${skill.score.toFixed(2)}) ---\n${promptContent.trim()}\n--- End ECC Skill ---`;
}

/**
 * Clear cached index (e.g. after sync)
 */
export function clearSkillIndexCache() {
  cachedCatalog = null;
  cachedTfIdfIndex = null;
  lastIndexMtime = 0;
}

/**
 * Generic TF-IDF engine — extracted from autoRouter.js.
 * No knowledge of ECC catalog or local skills; pure math.
 */
import { stemWord } from "../../scripts/sync-ecc-skills.js";

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
  "would", "could", "code", "file", "please", "help", "want", "like", "make", "need",
]);

/** Tokenize + stem text into normalized terms. */
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
    if (st && st !== w && st.length > 2) tokens.push(st);
  }
  return tokens;
}

/**
 * Build TF-IDF index from an array of docs.
 * @param {Array<{id, name, description, triggers, keywords}>} docs
 * @returns {{ docVectors, df, numDocs }}
 */
export function buildTfIdfIndex(docs) {
  const numDocs = docs.length;
  if (numDocs === 0) return { docVectors: [], df: {}, numDocs: 0 };

  const df = {};
  const docTokensList = [];

  for (const doc of docs) {
    const idTokens = tokenize(doc.id || "");
    const nameTokens = tokenize(doc.name || "");
    const descTokens = tokenize(doc.description || "");
    const kwTokens = (doc.keywords || []).flatMap((k) => tokenize(k));
    const trigTokens = (doc.triggers || []).flatMap((t) => tokenize(t));

    // name/id/keywords weighted higher
    const allTokens = [
      ...idTokens, ...idTokens, ...idTokens,
      ...nameTokens, ...nameTokens, ...nameTokens,
      ...kwTokens, ...kwTokens,
      ...trigTokens,
      ...descTokens,
    ];
    docTokensList.push(allTokens);

    const unique = new Set(allTokens);
    for (const term of unique) df[term] = (df[term] || 0) + 1;
  }

  const docVectors = docs.map((doc, i) => {
    const tokens = docTokensList[i];
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

    const vec = {};
    let sumSq = 0;
    for (const [term, count] of Object.entries(tf)) {
      const idf = Math.log((1 + numDocs) / (1 + (df[term] || 0))) + 1;
      const weight = count * idf;
      vec[term] = weight;
      sumSq += weight * weight;
    }
    const norm = Math.sqrt(sumSq) || 1;
    for (const term of Object.keys(vec)) vec[term] /= norm;

    return {
      id: doc.id,
      folder: doc.folder || doc.id,
      name: doc.name,
      description: doc.description || "",
      triggers: doc.triggers || [],
      vector: vec,
    };
  });

  return { docVectors, df, numDocs };
}

/**
 * Score a query against a pre-built index.
 * @param {{ docVectors, df, numDocs }} index
 * @param {string} queryText
 * @param {{ threshold?, maxSkills? }} opts
 * @returns {Array<{id, folder, name, description, score}>}
 */
export function scoreQuery(index, queryText, { threshold = 0.35, maxSkills = Infinity } = {}) {
  if (!index.docVectors?.length || !queryText) return [];

  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return [];

  const lowerQuery = queryText.toLowerCase();

  const qTf = {};
  for (const t of queryTokens) qTf[t] = (qTf[t] || 0) + 1;

  const qVec = {};
  let qSumSq = 0;
  for (const [term, count] of Object.entries(qTf)) {
    const idf = Math.log((1 + index.numDocs) / (1 + (index.df[term] || 0))) + 1;
    const weight = count * idf;
    qVec[term] = weight;
    qSumSq += weight * weight;
  }
  const qNorm = Math.sqrt(qSumSq) || 1;
  for (const term of Object.keys(qVec)) qVec[term] /= qNorm;

  const scored = [];
  for (const doc of index.docVectors) {
    let dot = 0;
    for (const [term, qWeight] of Object.entries(qVec)) {
      if (doc.vector[term]) dot += qWeight * doc.vector[term];
    }

    let triggerBoost = 0;
    for (const trig of doc.triggers) {
      if (trig && trig.length > 3 && lowerQuery.includes(trig)) {
        triggerBoost = Math.max(triggerBoost, 0.35);
      }
    }

    const totalScore = Math.min(1.0, dot * 1.8 + triggerBoost);
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
  return maxSkills === Infinity ? scored : scored.slice(0, maxSkills);
}

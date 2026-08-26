/**
 *
 * When multiple skills inject system-prompt text, the same boilerplate paragraphs
 * can appear multiple times (e.g. "You are a helpful assistant." from 3 skills).
 * This deduplicates at the paragraph level before injection.
 *
 * Cache: keyed by skillSetHash (from session cache). Invalidated when
 * the skill set changes. Max 200 entries (skill sets are few and stable).
 *
 * Fail-open: any error returns the original text unchanged.
 *
 * ponytail: add sentence-level dedup when paragraph-level proves insufficient.
 */

/** @type {Map<string, string>} skillSetHash → deduplicated prompt */
const cache = new Map();
const CACHE_MAX = 200;

/**
 * Deduplicate paragraphs across a concatenated system prompt string.
 * Preserves order of first occurrence.
 *
 * @param {string} text - Concatenated system prompt
 * @returns {string} Deduplicated text
 */
export function dedupParagraphs(text) {
  if (!text || typeof text !== "string") return text;
  try {
    const paragraphs = text.split(/\n{2,}/);
    const seen = new Set();
    const result = [];
    for (const para of paragraphs) {
      const key = para.trim();
      if (!key) continue;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(para.trim());
      }
    }
    return result.join("\n\n");
  } catch {
    return text;
  }
}

/**
 * Get or compute a deduplicated prompt for a skill set hash.
 * @param {string} skillSetHash
 * @param {string} rawPrompt
 * @returns {string}
 */
export function getCachedDedupPrompt(skillSetHash, rawPrompt) {
  if (cache.has(skillSetHash)) return cache.get(skillSetHash);
  const deduped = dedupParagraphs(rawPrompt);
  if (cache.size >= CACHE_MAX) {
    // Evict oldest
    cache.delete(cache.keys().next().value);
  }
  cache.set(skillSetHash, deduped);
  return deduped;
}

/**
 * Invalidate cache entry for a skill set hash.
 * @param {string} skillSetHash
 */
export function invalidateDedupCache(skillSetHash) {
  cache.delete(skillSetHash);
}

/**
 *
 * Stores metadata-only per conversation fingerprint (session ID):
 *   - compiled system-prompt hash (invalidated on skill config change)
 *   - failoverCount (how many times this session fell back to another provider)
 *   - lastSeenAt (for TTL eviction)
 *
 * NEVER stores raw message content — only hashes, counters, timestamps.
 *
 * LRU eviction: when capacity is exceeded, the least-recently-used entry is dropped.
 * TTL eviction: entries older than TTL_MS are dropped on access.
 *
 * Acceptance target: 500 concurrent fingerprints, RSS delta < 2 MB.
 * Each entry is ~200 bytes → 500 entries ≈ 100 KB. Well within budget.
 *
 * ponytail: add persistence across restarts via DB when session analytics land.
 */

const CAPACITY = 2000;       // max concurrent sessions
const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** @type {Map<string, SessionEntry>} */
const lru = new Map();

/**
 * @typedef {object} SessionEntry
 * @property {string}  skillSetHash    - Hash of active skill set (for prompt cache invalidation)
 * @property {string}  compiledPromptHash - Hash of compiled system prompt output
 * @property {number}  failoverCount   - Times this session fell back to another provider
 * @property {number}  lastSeenAt      - epoch ms
 * @property {number}  lastMemoryExtractionAt - epoch ms when memory extraction was last triggered
 * @property {string[]} injectedSkillIds - ECC/local skill ids whose FULL prompt has already
 *   been injected earlier in this session. Used to downgrade repeat injections to a short
 *   "already provided" reminder instead of re-sending the whole skill prompt every turn.
 */

function evictExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of lru) {
    if (entry.lastSeenAt < cutoff) lru.delete(key);
  }
}

function evictLRU() {
  // Map iteration order = insertion order; first key = LRU
  const firstKey = lru.keys().next().value;
  if (firstKey !== undefined) lru.delete(firstKey);
}

function touch(sessionId) {
  const entry = lru.get(sessionId);
  if (!entry) return null;
  // Re-insert to move to end (MRU position)
  lru.delete(sessionId);
  entry.lastSeenAt = Date.now();
  lru.set(sessionId, entry);
  return entry;
}

/**
 * Get session metadata. Returns null if not found or expired.
 * @param {string} sessionId
 * @returns {SessionEntry|null}
 */
export function getSession(sessionId) {
  const entry = lru.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.lastSeenAt > TTL_MS) { lru.delete(sessionId); return null; }
  return touch(sessionId);
}

/**
 * Set or update session metadata.
 * @param {string} sessionId
 * @param {Partial<SessionEntry>} updates
 * @returns {SessionEntry}
 */
export function setSession(sessionId, updates) {
  const existing = lru.get(sessionId) ?? { skillSetHash: "", compiledPromptHash: "", failoverCount: 0, lastSeenAt: 0, lastMemoryExtractionAt: 0 };
  const next = { ...existing, ...updates, lastSeenAt: Date.now() };

  if (lru.has(sessionId)) lru.delete(sessionId); // re-insert for MRU
  lru.set(sessionId, next);

  // Evict if over capacity
  if (lru.size > CAPACITY) {
    evictExpired();
    if (lru.size > CAPACITY) evictLRU();
  }

  return next;
}

/**
 * Increment failover counter for a session.
 * @param {string} sessionId
 * @returns {number} new failoverCount
 */
export function incrementFailover(sessionId) {
  const entry = getSession(sessionId) ?? { skillSetHash: "", compiledPromptHash: "", failoverCount: 0, lastSeenAt: 0, lastMemoryExtractionAt: 0 };
  const next = setSession(sessionId, { failoverCount: entry.failoverCount + 1 });
  return next.failoverCount;
}

/**
 * Whether this session has previously fallen over to another account/model.
 * Used to warn the (possibly new) model that earlier turns may have been
 * handled by a different underlying model, so it should check history
 * before repeating research/tool calls.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function hasPriorFailover(sessionId) {
  if (!sessionId) return false;
  const entry = getSession(sessionId);
  return !!entry && entry.failoverCount > 0;
}

/**
 * Record that a skill's FULL prompt has been injected for this session, and
 * report whether it was already injected before (i.e. this is a repeat turn
 * for that skill within the same conversation).
 * @param {string} sessionId
 * @param {string} skillId
 * @returns {boolean} true if this skill was already injected earlier in this session
 */
export function markSkillInjected(sessionId, skillId) {
  if (!sessionId || !skillId) return false;
  const entry = getSession(sessionId) ?? { skillSetHash: "", compiledPromptHash: "", failoverCount: 0, lastSeenAt: 0, lastMemoryExtractionAt: 0, injectedSkillIds: [] };
  const injected = Array.isArray(entry.injectedSkillIds) ? entry.injectedSkillIds : [];
  const alreadyInjected = injected.includes(skillId);
  if (!alreadyInjected) {
    setSession(sessionId, { injectedSkillIds: [...injected, skillId] });
  } else {
    // still touch lastSeenAt / MRU position
    setSession(sessionId, { injectedSkillIds: injected });
  }
  return alreadyInjected;
}

/**
 * Invalidate compiled prompt cache for all sessions using a given skill set hash.
 * Called when skill config changes.
 * @param {string} skillSetHash
 */
export function invalidateSkillSet(skillSetHash) {
  for (const [, entry] of lru) {
    if (entry.skillSetHash === skillSetHash) {
      entry.compiledPromptHash = "";
    }
  }
}

/** Current cache size (for diagnostics). */
export function cacheSize() { return lru.size; }

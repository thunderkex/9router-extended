/**
 * Local skill router — topic-aware injection for routable local skills.
 * Uses the same TF-IDF engine as autoRouter.js (ECC), but scores each
 * skill independently against its own routing_threshold.
 */
import { getSkillManifests } from "@/lib/skillsRegistry.js";
import { buildTfIdfIndex, scoreQuery } from "./tfidf.js";
import { extractUserQuery } from "./autoRouter.js";

export const LOCAL_ROUTER_BYPASS_HEADER = "x-9router-local-skill-router";

const MAX_LOCAL_SKILLS_PER_REQUEST = 2;

let cachedIndex = null;
let cachedSignature = null;

async function getRoutableLocalSkills() {
  const skills = await getSkillManifests();
  return skills.filter(
    (s) =>
      (s.routable === true ||
        (Array.isArray(s.config_schema) && s.config_schema.some((c) => c.key === "routing_mode"))) &&
      s.hook === "system-prompt" &&
      s.prompt_template
  );
}

async function getLocalSkillIndex() {
  const routable = await getRoutableLocalSkills();
  // Signature: id + prompt length — rebuilds if any prompt changes
  const signature = routable.map((s) => `${s.id}:${s.prompt_template.length}`).join("|");
  if (cachedIndex && cachedSignature === signature) return { index: cachedIndex, routable };

  const docs = routable.map((s) => ({
    id: s.id,
    folder: s.id,
    name: s.name,
    description: s.description || "",
    triggers: s.triggers || [],
    keywords: s.keywords || [],
  }));

  cachedIndex = buildTfIdfIndex(docs);
  cachedSignature = signature;
  return { index: cachedIndex, routable };
}

/**
 * Classify request body against routable local skills.
 * Each skill is scored against its own routing_threshold (default 0.35).
 * Skills with routing_mode "always" are NOT returned here — they're handled
 * by the generic loop in chat.js.
 *
 * @param {object} body - Request body
 * @param {object} chatSettings - Current settings (for per-skill routing_mode overrides)
 * @returns {Promise<Array<{id, name, score, prompt_template, skill}>>}
 */
export async function classifyLocalSkills(body, chatSettings = {}) {
  const { index, routable } = await getLocalSkillIndex();
  if (!index.docVectors?.length) return [];

  const queryText = extractUserQuery(body);
  if (!queryText) return [];

  // Short trivial queries skip classification
  if (/^(hi|hello|hey|\d+\s*[+\-*/]\s*\d+)$/i.test(queryText.trim())) return [];

  const byId = Object.fromEntries(routable.map((s) => [s.id, s]));

  // Score all candidates with floor threshold; filter per-skill below
  const allScored = scoreQuery(index, queryText, { threshold: 0.01, maxSkills: Infinity });

  const matched = allScored
    .filter((m) => {
      const skill = byId[m.id];
      if (!skill) return false;
      // Respect per-skill routing_mode override from settings
      const routingMode =
        chatSettings[`${skill.id}RoutingMode`] ??
        chatSettings[`${skill.id}_routing_mode`] ??
        skill.config_schema?.find((c) => c.key === "routing_mode")?.default ??
        "smart";
      if (routingMode === "always") return false; // handled by generic loop
      const enabledKey = skill.legacy_enabled_key || `${skill.id}Enabled`;
      const isEnabled =
        chatSettings[enabledKey] !== undefined
          ? !!chatSettings[enabledKey]
          : !!skill.default_enabled;
      if (!isEnabled) return false;
      return m.score >= (skill.routing_threshold ?? 0.35);
    })
    .slice(0, MAX_LOCAL_SKILLS_PER_REQUEST);

  return matched.map((m) => ({
    ...m,
    prompt_template: byId[m.id].prompt_template,
    skill: byId[m.id],
  }));
}

export function clearLocalSkillIndexCache() {
  cachedIndex = null;
  cachedSignature = null;
}

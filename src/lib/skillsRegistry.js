import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "node:url";

/** Valid hook types for skill manifests. */
export const VALID_HOOK_TYPES = new Set([
  "system-prompt",
  "install-cli",
  "pre-route",
  "pre-request",
  "post-response",
]);

/** Validate a skill manifest. Returns array of error strings (empty = valid). */
export function validateManifest(manifest, skillId) {
  const errors = [];
  if (!manifest.id || typeof manifest.id !== "string") errors.push("missing or invalid 'id'");
  if (!manifest.name || typeof manifest.name !== "string") errors.push("missing or invalid 'name'");
  if (manifest.hook && !VALID_HOOK_TYPES.has(manifest.hook)) {
    errors.push(`unknown hook type '${manifest.hook}'; valid: ${[...VALID_HOOK_TYPES].join(", ")}`);
  }
  return errors;
}

let cachedManifests = null;

async function findSkillsDir() {
  const candidates = [
    path.join(process.cwd(), "skills"),
    path.join(__dirname, "..", "..", "skills"),
    path.join(__dirname, "..", "skills"),
    path.join(__dirname, "skills"),
    path.join(process.env.APPDATA || "", "npm", "node_modules", "9router", "cli", "app", "skills"),
    path.join(process.env.HOME || "", ".9router", "skills"),
  ];

  for (const dir of candidates) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) return dir;
    } catch {}
  }
  return path.join(process.cwd(), "skills");
}

export async function getSkillManifests() {
  if (cachedManifests) return cachedManifests;
  try {
    const skillsDir = await findSkillsDir();
    let items = [];
    try {
      items = await fs.readdir(skillsDir, { withFileTypes: true });
    } catch (e) {
      return [];
    }

    const manifests = [];
    for (const item of items) {
      if (item.isDirectory()) {
        const manifestPath = path.join(skillsDir, item.name, "manifest.json");
        try {
          const content = await fs.readFile(manifestPath, "utf-8");
          const manifest = JSON.parse(content);

          // If prompt.txt or prompt.md exists in skill dir, load it if prompt_template is missing or to override
          const promptTxtPath = path.join(skillsDir, item.name, "prompt.txt");
          const promptMdPath = path.join(skillsDir, item.name, "prompt.md");
          try {
            manifest.prompt_template = await fs.readFile(promptTxtPath, "utf-8");
          } catch {
            try {
              manifest.prompt_template = await fs.readFile(promptMdPath, "utf-8");
            } catch {}
          }

          const validationErrors = validateManifest(manifest, item.name);
          if (validationErrors.length > 0) {
            console.warn(`[skills] Skipping '${item.name}': ${validationErrors.join("; ")}`);
            continue;
          }
          manifests.push(manifest);
        } catch (e) {
          // Ignore folders without valid manifest.json
        }      }
    }
    cachedManifests = manifests;
    return manifests;
  } catch (error) {
    console.error("Error loading skill manifests:", error);
    return [];
  }
}

export async function createCustomSkill(skillData) {
  try {
    const skillsDir = await findSkillsDir();
    const skillFolder = path.join(skillsDir, skillData.id);
    await fs.mkdir(skillFolder, { recursive: true });

    const manifest = {
      id: skillData.id,
      name: skillData.name,
      description: skillData.description,
      version: skillData.version || "1.0.0",
      category: skillData.category || (skillData.hook === "install-cli" ? "agent-skill" : "prompt-injection"),
      hook: skillData.hook || "system-prompt",
      default_enabled: skillData.default_enabled !== false,
      source: skillData.source || "custom",
    };

    if (skillData.install_command) manifest.install_command = skillData.install_command;
    if (skillData.update_command) manifest.update_command = skillData.update_command;
    if (skillData.uninstall_command) manifest.uninstall_command = skillData.uninstall_command;
    if (skillData.config_schema && skillData.config_schema.length > 0) {
      manifest.config_schema = skillData.config_schema;
    }

    await fs.writeFile(
      path.join(skillFolder, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );

    if (skillData.prompt_template) {
      await fs.writeFile(
        path.join(skillFolder, "prompt.txt"),
        skillData.prompt_template,
        "utf-8"
      );
    }

    if (skillData.hook_script) {
      await fs.writeFile(
        path.join(skillFolder, "hook.js"),
        skillData.hook_script,
        "utf-8"
      );
    }

    cachedManifests = null;
    return { success: true, manifest };
  } catch (error) {
    console.error("Error creating custom skill:", error);
    throw error;
  }
}

export async function deleteCustomSkill(skillId) {
  try {
    const skillsDir = await findSkillsDir();
    const skillFolder = path.join(skillsDir, skillId);
    await fs.rm(skillFolder, { recursive: true, force: true });
    cachedManifests = null;
    return { success: true };
  } catch (error) {
    console.error("Error deleting custom skill:", error);
    throw error;
  }
}

/**
 *
 * For `pre-route`: each skill's hook.js exports `preRoute(body, context)` → body (mutated or replaced).
 * For `post-response`: each skill's hook.js exports `postResponse(response, context)` → response.
 *
 * Fail-open: any error in a skill hook is logged and skipped.
 *
 * @param {"pre-route"|"post-response"} hookType
 * @param {string[]} enabledSkillIds
 * @param {any} payload - body (pre-route) or response (post-response)
 * @param {object} context - { provider, model, sessionId, ... }
 * @returns {Promise<any>} mutated payload
 */
export async function dispatchHook(hookType, enabledSkillIds, payload, context = {}) {
  if (!enabledSkillIds || enabledSkillIds.length === 0) return payload;
  const manifests = await getSkillManifests();
  const skillsDir = await findSkillsDir();

  for (const manifest of manifests) {
    if (!enabledSkillIds.includes(manifest.id)) continue;
    if (manifest.hook !== hookType) continue;

    const hookFile = path.join(skillsDir, manifest.id, "hook.js");
    try {
      const hookUrl = pathToFileURL(hookFile).href;
      const mod = await import(/* webpackIgnore: true */ hookUrl);
      if (hookType === "pre-route" && typeof mod.preRoute === "function") {
        payload = (await mod.preRoute(payload, context)) ?? payload;
      } else if (hookType === "post-response" && typeof mod.postResponse === "function") {
        payload = (await mod.postResponse(payload, context)) ?? payload;
      }
    } catch (err) {
      console.warn(`[skills] ${hookType} hook error in '${manifest.id}':`, err?.message || err);
      // Fail-open: continue with unmodified payload
    }
  }
  return payload;
}

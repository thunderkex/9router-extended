import fs from "fs/promises";
import path from "path";

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

          manifests.push(manifest);
        } catch (e) {
          // Ignore folders without valid manifest.json
        }
      }
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
      category: skillData.category || (skillData.hook === "install-cli" ? "agent-skill" : "prompt-injection"),
      hook: skillData.hook || "system-prompt",
      default_enabled: skillData.default_enabled !== false,
      source: skillData.source || "custom",
    };

    if (skillData.install_command) manifest.install_command = skillData.install_command;
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

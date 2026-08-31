import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getHermesHomeDir } from "./paths.js";

const ENTRY_DELIMITER = "\n§\n";
const DEFAULT_MEMORY_LIMIT = 2200;
const DEFAULT_USER_LIMIT = 1375;

export function getHermesMemoriesDir() {
  const home = getHermesHomeDir();
  return path.join(home, "memories");
}

export function getHermesMemoryFilePath(target = "memory") {
  const memDir = getHermesMemoriesDir();
  return path.join(memDir, target === "user" ? "USER.md" : "MEMORY.md");
}

export function parseHermesEntries(rawContent) {
  if (!rawContent || typeof rawContent !== "string") return [];
  return rawContent
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter(Boolean);
}

export function serializeHermesEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  return entries.map((e) => e.trim()).filter(Boolean).join(ENTRY_DELIMITER);
}

export async function readHermesMemory(target = "memory") {
  const filePath = getHermesMemoryFilePath(target);
  try {
    if (!fsSync.existsSync(filePath)) {
      return [];
    }
    const content = await fs.readFile(filePath, "utf8");
    return parseHermesEntries(content);
  } catch (err) {
    return [];
  }
}

export async function writeHermesMemory(target = "memory", entries = []) {
  const memDir = getHermesMemoriesDir();
  const filePath = getHermesMemoryFilePath(target);
  try {
    await fs.mkdir(memDir, { recursive: true });
    const content = serializeHermesEntries(entries);
    await fs.writeFile(filePath, content, "utf8");
    return true;
  } catch (err) {
    return false;
  }
}

export async function appendHermesMemoryEntry(target = "memory", entryContent = "", charLimit = null) {
  const clean = (entryContent || "").trim();
  if (!clean) return { success: false, reason: "empty_content" };

  const limit = charLimit || (target === "user" ? DEFAULT_USER_LIMIT : DEFAULT_MEMORY_LIMIT);
  const currentEntries = await readHermesMemory(target);

  // Exact duplicate check
  if (currentEntries.includes(clean)) {
    return { success: true, duplicate: true, entries: currentEntries };
  }

  const nextEntries = [...currentEntries, clean];
  const serialized = serializeHermesEntries(nextEntries);
  if (serialized.length > limit) {
    // If over limit, replace oldest entry if feasible or fail-open
    while (nextEntries.length > 1 && serializeHermesEntries(nextEntries).length > limit) {
      nextEntries.shift();
    }
  }

  const ok = await writeHermesMemory(target, nextEntries);
  return { success: ok, entries: nextEntries };
}

export async function getHermesSystemPromptBlock() {
  try {
    const memoryEntries = await readHermesMemory("memory");
    const userEntries = await readHermesMemory("user");

    const blocks = [];
    if (memoryEntries.length > 0) {
      blocks.push(`MEMORY (Hermes Agent Notes):\n- ${memoryEntries.join("\n- ")}`);
    }
    if (userEntries.length > 0) {
      blocks.push(`USER PROFILE (Hermes Agent Context):\n- ${userEntries.join("\n- ")}`);
    }

    if (blocks.length === 0) return "";
    return `--- Hermes Agent Persistent Memory (Auto-Injected by 9router-extended) ---\n${blocks.join("\n\n")}\n--- End Hermes Agent Memory ---`;
  } catch {
    return "";
  }
}

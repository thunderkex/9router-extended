import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getHermesHomeDir } from "./paths.js";

export const HERMES_MEMORY_BYPASS_HEADER = "x-9router-hermes-memory";
const ENTRY_DELIMITER = "\n§\n";
const DEFAULT_MEMORY_LIMIT = 2200;
const DEFAULT_USER_LIMIT = 1375;
const MAX_SINGLE_ENTRY_CHARS = 500;

// Per-file promise queue to serialize writes
const fileQueues = new Map();

function enqueueFileOp(filePath, op) {
  const previous = fileQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(op);
  fileQueues.set(filePath, next);
  return next;
}

// In-memory cache for prompt block (invalidated by mtime)
let cachedPromptBlock = null;
let cachedMtimes = { memory: 0, user: 0 };

export function clearHermesMemoryPromptCache() {
  cachedPromptBlock = null;
  cachedMtimes = { memory: 0, user: 0 };
}

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
  return enqueueFileOp(filePath, async () => {
    try {
      await fs.mkdir(memDir, { recursive: true });
      const content = serializeHermesEntries(entries);
      await fs.writeFile(filePath, content, "utf8");
      clearHermesMemoryPromptCache();
      return true;
    } catch (err) {
      return false;
    }
  });
}

function truncateEntry(entry) {
  const trimmed = (entry || "").trim();
  if (trimmed.length <= MAX_SINGLE_ENTRY_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SINGLE_ENTRY_CHARS - 3) + "...";
}

export async function appendHermesMemoryEntry(target = "memory", entryContent = "", charLimit = null) {
  let clean = (entryContent || "").trim();
  if (!clean) return { success: false, reason: "empty_content" };
  clean = truncateEntry(clean);

  const limit = charLimit || (target === "user" ? DEFAULT_USER_LIMIT : DEFAULT_MEMORY_LIMIT);
  const filePath = getHermesMemoryFilePath(target);

  return enqueueFileOp(filePath, async () => {
    const currentEntries = await readHermesMemory(target);

    // Exact duplicate check
    if (currentEntries.includes(clean)) {
      return { success: true, duplicate: true, entries: currentEntries };
    }

    const nextEntries = [...currentEntries, clean];
    while (nextEntries.length > 1 && serializeHermesEntries(nextEntries).length > limit) {
      nextEntries.shift();
    }

    const memDir = getHermesMemoriesDir();
    try {
      await fs.mkdir(memDir, { recursive: true });
      const content = serializeHermesEntries(nextEntries);
      await fs.writeFile(filePath, content, "utf8");
      clearHermesMemoryPromptCache();
      return { success: true, entries: nextEntries };
    } catch {
      return { success: false, entries: currentEntries };
    }
  });
}

function getFileMtimeSafe(filePath) {
  try {
    if (fsSync.existsSync(filePath)) {
      return fsSync.statSync(filePath).mtimeMs;
    }
  } catch {}
  return 0;
}

export async function getHermesSystemPromptBlock() {
  try {
    const memPath = getHermesMemoryFilePath("memory");
    const userPath = getHermesMemoryFilePath("user");

    const memMtime = getFileMtimeSafe(memPath);
    const userMtime = getFileMtimeSafe(userPath);

    if (
      cachedPromptBlock !== null &&
      cachedMtimes.memory === memMtime &&
      cachedMtimes.user === userMtime
    ) {
      return cachedPromptBlock;
    }

    const memoryEntries = await readHermesMemory("memory");
    const userEntries = await readHermesMemory("user");

    const blocks = [];
    if (memoryEntries.length > 0) {
      blocks.push(`MEMORY (Hermes Agent Notes):\n- ${memoryEntries.join("\n- ")}`);
    }
    if (userEntries.length > 0) {
      blocks.push(`USER PROFILE (Hermes Agent Context):\n- ${userEntries.join("\n- ")}`);
    }

    if (blocks.length === 0) {
      cachedPromptBlock = "";
    } else {
      cachedPromptBlock = `--- Hermes Agent Persistent Memory (Auto-Injected by 9router-extended) ---\n${blocks.join("\n\n")}\n--- End Hermes Agent Memory ---`;
    }

    cachedMtimes.memory = memMtime;
    cachedMtimes.user = userMtime;
    return cachedPromptBlock;
  } catch {
    return "";
  }
}

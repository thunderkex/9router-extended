import { describe, it, expect, beforeEach } from "vitest";
import {
  parseHermesEntries,
  serializeHermesEntries,
  appendHermesMemoryEntry,
  getHermesSystemPromptBlock,
  writeHermesMemory,
} from "../../src/lib/plugins/hermes/memory.js";

describe("Hermes Memory Management Suite", () => {
  it("parses section sign (§) delimited entries correctly", () => {
    const raw = "First entry\n§\nSecond multiline\nentry\n§\nThird entry";
    const entries = parseHermesEntries(raw);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toBe("First entry");
    expect(entries[1]).toBe("Second multiline\nentry");
    expect(entries[2]).toBe("Third entry");
  });

  it("serializes entries with section sign delimiter", () => {
    const entries = ["Note A", "Note B"];
    const text = serializeHermesEntries(entries);
    expect(text).toBe("Note A\n§\nNote B");
  });

  it("formats Hermes prompt block cleanly", async () => {
    await writeHermesMemory("memory", ["Use Next.js 15", "Follow strict typing"]);
    await writeHermesMemory("user", ["Prefers caveman responses", "Working on 9router"]);

    const block = await getHermesSystemPromptBlock();
    expect(block).toContain("--- Hermes Agent Persistent Memory (Auto-Injected by 9router-extended) ---");
    expect(block).toContain("MEMORY (Hermes Agent Notes):");
    expect(block).toContain("- Use Next.js 15");
    expect(block).toContain("USER PROFILE (Hermes Agent Context):");
    expect(block).toContain("- Prefers caveman responses");
    expect(block).toContain("--- End Hermes Agent Memory ---");
  });

  it("appends entries respecting duplicate check and character bounds", async () => {
    const res1 = await appendHermesMemoryEntry("user", "Test habit 1", 500);
    expect(res1.success).toBe(true);

    const resDup = await appendHermesMemoryEntry("user", "Test habit 1", 500);
    expect(resDup.success).toBe(true);
    expect(resDup.duplicate).toBe(true);
  });
});

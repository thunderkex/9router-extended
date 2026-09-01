import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shouldExtractMemory,
  parseExtractionResponse,
  extractMemoryWithLLM,
  triggerHermesExtraction,
  EXTRACTION_SYSTEM_PROMPT,
} from "../../src/lib/plugins/hermes/extraction.js";
import { getSession, setSession } from "../../src/lib/session/cache.js";

describe("hermes extraction pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("shouldExtractMemory", () => {
    it("rejects short or empty text", () => {
      expect(shouldExtractMemory({ text: "" })).toBe(false);
      expect(shouldExtractMemory({ text: "hello" })).toBe(false);
      expect(shouldExtractMemory({ text: "please remember" })).toBe(false); // < 25 chars
    });

    it("rejects text without trigger keywords", () => {
      expect(
        shouldExtractMemory({
          text: "Can you write a function to calculate Fibonacci sequence in python?",
        })
      ).toBe(false);
    });

    it("accepts text with triggers and sufficient length", () => {
      expect(
        shouldExtractMemory({
          text: "Please remember that we always use TypeScript with strictNullChecks enabled in this project.",
        })
      ).toBe(true);

      expect(
        shouldExtractMemory({
          text: "My preference is to write concise caveman style comments whenever possible.",
        })
      ).toBe(true);
    });

    it("enforces cooldown per session", () => {
      const sessionId = "test-session-cooldown";
      const session = setSession(sessionId, { model: "test" });
      session.lastMemoryExtractionAt = Date.now();

      expect(
        shouldExtractMemory({
          text: "Please remember that my name is Alice and I work on backend services.",
          sessionId,
          cooldownSeconds: 60,
        })
      ).toBe(false);

      // After cooldown expires
      session.lastMemoryExtractionAt = Date.now() - 70000;
      expect(
        shouldExtractMemory({
          text: "Please remember that my name is Alice and I work on backend services.",
          sessionId,
          cooldownSeconds: 60,
        })
      ).toBe(true);
    });
  });

  describe("parseExtractionResponse", () => {
    it("parses valid JSON response", () => {
      const raw = JSON.stringify({
        user: ["Prefers tabs over spaces", "Uses Linux environment"],
        memory: ["Database is PostgreSQL 16 on port 5432"],
      });
      const result = parseExtractionResponse(raw);
      expect(result).toEqual({
        user: ["Prefers tabs over spaces", "Uses Linux environment"],
        memory: ["Database is PostgreSQL 16 on port 5432"],
      });
    });

    it("parses markdown fenced JSON", () => {
      const raw = "```json\n" + JSON.stringify({
        user: ["Prefers dark mode"],
        memory: [],
      }) + "\n```";
      const result = parseExtractionResponse(raw);
      expect(result).toEqual({
        user: ["Prefers dark mode"],
        memory: [],
      });
    });

    it("handles malformed JSON gracefully", () => {
      const result = parseExtractionResponse("Not JSON at all");
      expect(result).toEqual({ user: [], memory: [] });
    });
  });

  describe("extractMemoryWithLLM", () => {
    it("calls handleSingleModelChat with synthetic request and extracts facts", async () => {
      const mockChat = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  user: ["User is working with Next.js 15"],
                  memory: ["App uses SQLite driver fallback"],
                }),
              },
            },
          ],
        }),
      });

      const res = await extractMemoryWithLLM({
        text: "Please remember that we are building on Next.js 15 with SQLite driver fallback.",
        handleSingleModelChat: mockChat,
        extractionModel: "gpt-4o-mini",
      });

      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
          temperature: 0.1,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: EXTRACTION_SYSTEM_PROMPT }),
          ]),
        }),
        "gpt-4o-mini",
        null,
        expect.objectContaining({
          headers: expect.any(Object),
        }),
        null
      );

      expect(res).toEqual({
        user: ["User is working with Next.js 15"],
        memory: ["App uses SQLite driver fallback"],
      });
    });

    it("returns empty arrays if LLM call fails", async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error("Network error"));
      const res = await extractMemoryWithLLM({
        text: "Please remember something",
        handleSingleModelChat: mockChat,
      });
      expect(res).toEqual({ user: [], memory: [] });
    });
  });
});

import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: text-only parts become a newline-joined string,
// otherwise the array is returned as-is.
export function collapseTextParts(parts) {
  if (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every((p) => p?.type === OPENAI_BLOCK.TEXT && !p?.cache_control)
  ) {
    return parts.map((p) => p.text ?? "").join("\n");
  }
  return parts;
}

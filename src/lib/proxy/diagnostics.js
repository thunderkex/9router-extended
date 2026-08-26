/**
 *
 * Classifies upstream errors into structured Diagnostic objects that replace
 * raw upstream error passthrough in API responses. Fail-open: any unclassified
 * error falls through as-is so the core proxy cycle is never blocked.
 *
 * ponytail: add provider-specific hint lookup when provider error catalogs exist.
 */

export const DiagCode = /** @type {const} */ ({
  AUTH_FAILED:        "auth_failed",
  RATE_LIMITED:       "rate_limited",
  QUOTA_EXCEEDED:     "quota_exceeded",
  CONTEXT_TOO_LONG:   "context_too_long",
  MODEL_NOT_FOUND:    "model_not_found",
  PROVIDER_DOWN:      "provider_down",
  NETWORK_ERROR:      "network_error",
  TIMEOUT:            "timeout",
  INVALID_REQUEST:    "invalid_request",
  UNKNOWN:            "unknown",
});

const HTTP_PATTERNS = [
  { status: 401, code: DiagCode.AUTH_FAILED,      hint: "Check your API key or OAuth token for this provider." },
  { status: 403, code: DiagCode.AUTH_FAILED,      hint: "Access denied — token may lack required scopes." },
  { status: 429, code: DiagCode.RATE_LIMITED,     hint: "Provider rate limit hit. 9Router will retry with the next account." },
  { status: 402, code: DiagCode.QUOTA_EXCEEDED,   hint: "Billing quota exceeded for this provider account." },
  { status: 404, code: DiagCode.MODEL_NOT_FOUND,  hint: "Model not found on this provider. Check the model name or alias." },
  { status: 400, code: DiagCode.INVALID_REQUEST,  hint: "Bad request — check model parameters or message format." },
  { status: 413, code: DiagCode.CONTEXT_TOO_LONG, hint: "Request body too large. Enable RTK token compression." },
  { status: 503, code: DiagCode.PROVIDER_DOWN,    hint: "Provider is temporarily unavailable." },
  { status: 502, code: DiagCode.PROVIDER_DOWN,    hint: "Bad gateway from provider." },
  { status: 504, code: DiagCode.TIMEOUT,          hint: "Provider gateway timed out." },
];

const MESSAGE_PATTERNS = [
  { re: /context.{0,30}(length|window|too long|exceed)/i, code: DiagCode.CONTEXT_TOO_LONG, hint: "Reduce message history or enable RTK token compression." },
  { re: /rate.?limit|too many request/i,                  code: DiagCode.RATE_LIMITED,     hint: "Provider rate limit hit." },
  { re: /quota|billing|credit/i,                          code: DiagCode.QUOTA_EXCEEDED,   hint: "Billing quota exceeded." },
  { re: /invalid.{0,20}(api.?key|token|auth)/i,           code: DiagCode.AUTH_FAILED,      hint: "Invalid API key or token." },
  { re: /model.{0,30}(not found|does not exist)/i,        code: DiagCode.MODEL_NOT_FOUND,  hint: "Model not found on this provider." },
  { re: /timeout|timed out/i,                             code: DiagCode.TIMEOUT,          hint: "Request timed out." },
  { re: /ECONNREFUSED|ENOTFOUND|ECONNRESET|network/i,     code: DiagCode.NETWORK_ERROR,    hint: "Cannot reach provider. Check network or proxy settings." },
];

/**
 * @typedef {object} Diagnostic
 * @property {string} code       - DiagCode constant
 * @property {string} message    - Human-readable summary
 * @property {string} hint       - Actionable suggestion
 * @property {number} [status]   - HTTP status if available
 * @property {string} [provider] - Provider id if available
 */

/**
 * Classify an upstream error into a Diagnostic.
 * @param {{ status?: number, message?: string, provider?: string }} opts
 * @returns {Diagnostic}
 */
export function classify({ status, message = "", provider } = {}) {
  // HTTP status takes priority
  if (status) {
    const match = HTTP_PATTERNS.find((p) => p.status === status);
    if (match) {
      return { code: match.code, message: message || match.hint, hint: match.hint, status, provider };
    }
  }

  // Message pattern fallback
  for (const p of MESSAGE_PATTERNS) {
    if (p.re.test(message)) {
      return { code: p.code, message, hint: p.hint, status, provider };
    }
  }

  return { code: DiagCode.UNKNOWN, message: message || "An unknown error occurred.", hint: "Check server logs for details.", status, provider };
}

/**
 * Build an OpenAI-compatible error response body enriched with diagnostics.
 * @param {Diagnostic} diag
 * @returns {object}
 */
export function buildDiagnosticBody(diag) {
  return {
    error: {
      message: diag.message,
      type: diag.code === DiagCode.AUTH_FAILED ? "authentication_error"
          : diag.code === DiagCode.RATE_LIMITED ? "rate_limit_error"
          : diag.code === DiagCode.INVALID_REQUEST ? "invalid_request_error"
          : "server_error",
      code: diag.code,
      // Non-standard extension — clients that understand it get richer UX
      diagnostic: {
        hint: diag.hint,
        provider: diag.provider ?? null,
      },
    },
  };
}

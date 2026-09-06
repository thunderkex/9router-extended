/**
 * Freebuff — the free, ad-supported coding agent by Codebuff (freebuff.com).
 *
 * The Freebuff CLI (github.com/CodebuffAI/freebuff) is an interactive TUI that
 * talks to the Codebuff/Freebuff backend. Two hosts are involved:
 *   - login flow (freebuff mode) runs on  https://freebuff.com
 *       POST /api/auth/cli/code {fingerprintId} → { loginUrl, fingerprintHash, expiresAt }
 *       open loginUrl in browser, then GET /api/auth/cli/status until {user}.
 *       (The server echoes the request host into loginUrl, so calling
 *       freebuff.com yields freebuff.com/login?auth_code=… exactly like the
 *       official CLI — www.codebuff.com would yield the wrong link.)
 *   - LLM traffic goes to the OpenAI-compatible endpoint on
 *       https://www.codebuff.com/api/v1/chat/completions
 *     (freebuff.com does NOT serve /api/v1/* — it 404s with the SPA shell.)
 *
 * Both hosts share one backend: the authToken obtained via the freebuff.com
 * login validates against www.codebuff.com (Bearer auth). The request body
 * must carry the CLI's `codebuff` provider block
 * (`codebuff_metadata.run_id/client_id/cost_mode`) — injected by
 * executors/freebuff.js. cost_mode:"free" is what admits a session on the free
 * (country-gated, session-limited) tier instead of billing credits.
 */
const freebuffRegistry = {
  id: "freebuff",
  priority: 45,
  hasFree: true,
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#84CC16",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
      text: "Free ad-supported coding agent by Codebuff. Sign in with your Freebuff/Codebuff account via browser login. Free tier is ad-supported and limited in some regions (limited mode: 6 x 1-hour sessions/day); full mode runs in select countries. ⚠️ One account has ONE active session locked to ONE model — requesting a different model while a session is active returns 'model_locked' (409); use a separate account per model, or wait for the session to expire.",
    },
  },
  category: "free",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "ai-sdk/openai-compatible/1.0/codebuff",
    },
    retry: {
      429: { attempts: 2, delayMs: 2000 },
      503: { attempts: 2, delayMs: 1500 },
    },
    // Session endpoint doubles as the quota API: GET /api/v1/freebuff/session
    // returns the shared daily session quota (rateLimitsByModel) without
    // claiming anything — POST would burn a session, so quota reads are GET
    // only (see services/usage/freebuff.js).
    usage: {
      url: "https://www.codebuff.com/api/v1/freebuff/session",
    },
  },
  features: {
    usage: true,
  },
  // Mirrors the CLI's free picker (FREEBUFF_ROOT_AGENT_ID_BY_MODEL).
  // mimo/mimo-v2.5-pro is intentionally absent — it is not a free-tier model
  // and would bill credits or be rejected under the base3-free agent.
  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "mimo/mimo-v2.5", name: "MiMo 2.5" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
  ],
  // Login-flow host — the CLI in freebuff mode logs in via freebuff.com, and
  // the server builds loginUrl from the host it was called on, so the link the
  // user opens must come from freebuff.com to match the official CLI.
  oauth: {
    baseUrl: "https://freebuff.com",
    loginCodePath: "/api/auth/cli/code",
    loginStatusPath: "/api/auth/cli/status",
    oauthTimeoutMs: 300000,
  },
};

export default freebuffRegistry;

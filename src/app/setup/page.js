"use client";

/**
 *
 * Shown when /api/init returns needsSetup=true (no providers configured).
 * Guides the user to add their first provider without manual config file edits.
 * Redirects to /dashboard once a provider is connected.
 */

import { useState, useEffect } from "react";

const FREE_PROVIDERS = [
  { id: "kiro",         label: "Kiro (AWS)",          authType: "oauth", hint: "Free tier via AWS builder ID — no credit card." },
  { id: "antigravity",  label: "Antigravity",          authType: "oauth", hint: "Free tier OAuth provider." },
  { id: "github",       label: "GitHub Copilot",       authType: "oauth", hint: "Requires active Copilot subscription." },
  { id: "gemini-cli",   label: "Gemini CLI",           authType: "oauth", hint: "Free tier via Google account." },
  { id: "openrouter",   label: "OpenRouter (API key)", authType: "apikey", hint: "Paste your OpenRouter API key for access to many models." },
];

export default function SetupPage() {
  const [step, setStep] = useState("welcome"); // welcome | pick | connect | done
  const [selected, setSelected] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // If already set up, redirect immediately
  useEffect(() => {
    fetch("/api/init").then((r) => r.json()).then((d) => {
      if (!d.needsSetup) window.location.href = "/dashboard";
    }).catch(() => {});
  }, []);

  async function connectOAuth(providerId) {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/oauth/${providerId}/start`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const { url } = await r.json();
      window.location.href = url;
    } catch (e) {
      setError(e.message || "Failed to start OAuth flow.");
      setSaving(false);
    }
  }

  async function connectApiKey(providerId) {
    if (!apiKey.trim()) { setError("API key is required."); return; }
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, authType: "apikey", apiKey: apiKey.trim(), name: "Default" }),
      });
      if (!r.ok) throw new Error(await r.text());
      setStep("done");
    } catch (e) {
      setError(e.message || "Failed to save provider.");
    } finally {
      setSaving(false);
    }
  }

  const provider = FREE_PROVIDERS.find((p) => p.id === selected);

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.logo}>9Router</div>

        {step === "welcome" && (
          <>
            <h1 style={styles.h1}>Welcome to 9Router</h1>
            <p style={styles.sub}>No providers connected yet. Add one to start routing AI requests.</p>
            <button style={styles.btn} onClick={() => setStep("pick")}>Get started →</button>
          </>
        )}

        {step === "pick" && (
          <>
            <h1 style={styles.h1}>Pick a provider</h1>
            <p style={styles.sub}>Choose a free provider to connect first. You can add more later.</p>
            <div style={styles.list}>
              {FREE_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  style={{ ...styles.providerBtn, ...(selected === p.id ? styles.providerBtnActive : {}) }}
                  onClick={() => { setSelected(p.id); setStep("connect"); setError(""); setApiKey(""); }}
                >
                  <span style={styles.providerLabel}>{p.label}</span>
                  <span style={styles.providerHint}>{p.hint}</span>
                </button>
              ))}
            </div>
            <button style={styles.linkBtn} onClick={() => window.location.href = "/dashboard"}>
              Skip — I&apos;ll configure manually
            </button>
          </>
        )}

        {step === "connect" && provider && (
          <>
            <h1 style={styles.h1}>Connect {provider.label}</h1>
            <p style={styles.sub}>{provider.hint}</p>
            {error && <p style={styles.error}>{error}</p>}
            {provider.authType === "oauth" ? (
              <button style={styles.btn} onClick={() => connectOAuth(provider.id)} disabled={saving}>
                {saving ? "Redirecting…" : `Sign in with ${provider.label}`}
              </button>
            ) : (
              <>
                <input
                  style={styles.input}
                  type="password"
                  placeholder="Paste API key…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connectApiKey(provider.id)}
                />
                <button style={styles.btn} onClick={() => connectApiKey(provider.id)} disabled={saving}>
                  {saving ? "Saving…" : "Connect"}
                </button>
              </>
            )}
            <button style={styles.linkBtn} onClick={() => { setStep("pick"); setError(""); }}>← Back</button>
          </>
        )}

        {step === "done" && (
          <>
            <h1 style={styles.h1}>You&apos;re connected!</h1>
            <p style={styles.sub}>Your first provider is ready. Head to the dashboard to start routing.</p>
            <button style={styles.btn} onClick={() => window.location.href = "/dashboard"}>Open dashboard →</button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a", fontFamily: "system-ui, sans-serif" },
  card: { background: "#111", border: "1px solid #222", borderRadius: 12, padding: "2.5rem 2rem", maxWidth: 440, width: "100%", display: "flex", flexDirection: "column", gap: "1rem" },
  logo: { fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" },
  h1: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#f0f0f0", lineHeight: 1.2 },
  sub: { margin: 0, fontSize: "0.9rem", color: "#888", lineHeight: 1.6 },
  btn: { padding: "0.65rem 1.25rem", background: "#e8e8e8", color: "#0a0a0a", border: "none", borderRadius: 7, fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", alignSelf: "flex-start" },
  linkBtn: { background: "none", border: "none", color: "#555", fontSize: "0.85rem", cursor: "pointer", padding: 0, textAlign: "left" },
  list: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  providerBtn: { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, padding: "0.75rem 1rem", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 2 },
  providerBtnActive: { borderColor: "#555", background: "#222" },
  providerLabel: { color: "#e0e0e0", fontWeight: 600, fontSize: "0.9rem" },
  providerHint: { color: "#666", fontSize: "0.8rem" },
  input: { padding: "0.6rem 0.8rem", background: "#1a1a1a", border: "1px solid #333", borderRadius: 7, color: "#e0e0e0", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" },
  error: { color: "#f87171", fontSize: "0.85rem", margin: 0 },
};

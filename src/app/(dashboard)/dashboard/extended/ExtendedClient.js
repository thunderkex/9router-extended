"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, Toggle, Badge, Modal, Input, ConfigSlider, ConfirmModal } from "@/shared/components";
import HermesPluginCard from "./components/HermesPluginCard";

const DEFAULT_PRE_ROUTE_SCRIPT = `/**
 * Pre-Route Hook
 * Executes before request resolution and provider forwarding.
 * @param {object} body - OpenAI/Claude/Gemini request payload
 * @param {object} context - { provider, model, sessionId, headers }
 * @returns {Promise<object>|object} Modified request body
 */
export async function preRoute(body, context) {
  // Example: Append a tracking metadata tag or inspect messages
  if (body && body.messages) {
    // console.log("[PreRoute Hook] Processing request for model:", context.model);
  }
  return body;
}`;

const DEFAULT_POST_RESPONSE_SCRIPT = `/**
 * Post-Response Hook
 * Intercepts and transforms upstream JSON responses before returning to client.
 * @param {object} response - Provider response payload
 * @param {object} context - { provider, model, sessionId }
 * @returns {Promise<object>|object} Modified response object
 */
export async function postResponse(response, context) {
  // Example: Sanitize output or audit response metadata
  // console.log("[PostResponse Hook] Intercepted response from:", context.provider);
  return response;
}`;

const PRESET_TEMPLATES = [
  {
    name: "UI Design Taste Rule",
    icon: "palette",
    desc: "Anti-slop frontend aesthetics, 8-state components, curated palettes",
    hook: "system-prompt",
    category: "prompt-injection",
    id: "custom-design-taste",
    skillName: "Custom Design Taste",
    description: "Enforces tailored OKLCH palettes, micro-interactions, and 8-state design discipline.",
    prompt: `When generating or modifying frontend code:
- Avoid generic saturated primary colors; use curated tokens with OKLCH or HSL.
- Support full interaction states (default, hover, active, focus-visible, disabled, loading, empty, error).
- Never use boring AI placeholder layouts; craft expressive visual hierarchy.

Dynamic Configuration:
- Design Variance: {design_variance} / 10
  * [1-3]: Strict, minimal, conservative structure with restrained ornamentation.
  * [4-7]: Balanced, modern anti-slop design with polished visual hierarchy.
  * [8-10]: Highly expressive, bold asymmetry, editorial typography, and bespoke visual DNA.
- Motion Intensity: {motion_intensity} / 10
  * [1-3]: Reduced motion, fast subtle opacity transitions (0.1s - 0.15s).
  * [4-7]: Smooth interactive physics, responsive micro-hover transitions (0.2s - 0.3s).
  * [8-10]: Dynamic fluid choreographies, expressive state transitions, and spring animations.`,
    config_schema: [
      { key: "design_variance", type: "slider", label: "Design Variance", min: 1, max: 10, default: 6 },
      { key: "motion_intensity", type: "slider", label: "Motion Intensity", min: 1, max: 10, default: 5 },
    ],
  },
  {
    name: "Security & Privacy Guard",
    icon: "shield",
    desc: "Blocks credential leakages and sanitizes private keys & tokens",
    hook: "system-prompt",
    category: "prompt-injection",
    id: "security-guard",
    skillName: "Security & Privacy Guard",
    description: "Prevents leaking API keys, private tokens, and sensitive env variables in outputs.",
    prompt: `CRITICAL SECURITY DIRECTIVE:
- Never reveal, repeat, or embed raw API keys, secrets, or JWT tokens in generated responses.
- Always use environment variables or secure credential placeholders.
- Flag any unsafe code patterns (SQL injection, XSS, eval, insecure deserialization).

Dynamic Configuration:
- Security Strictness: {strictness} / 10
  * [1-3]: Standard warnings for obvious credentials, permit mock/test keys in code examples.
  * [4-7]: Strict redaction for known API key formats (sk-*, ghp_*, etc.) and automated security suggestions.
  * [8-10]: Maximum zero-trust paranoia: aggressively redact all potential secrets, enforce environment variables, and block dangerous system calls.`,
    config_schema: [
      { key: "strictness", type: "slider", label: "Security Strictness", min: 1, max: 10, default: 8 },
    ],
  },
  {
    name: "Pre-Route Context & Header Hook",
    icon: "alt_route",
    desc: "Middleware executing before model resolution & upstream routing",
    hook: "pre-route",
    category: "middleware",
    id: "pre-route-header-guard",
    skillName: "Pre-Route Header & Context Guard",
    description: "Intercepts request payloads to inject custom context headers or enforce metadata before routing.",
    hook_script: `/**
 * Pre-Route Hook
 * Executes before request resolution and provider forwarding.
 */
export async function preRoute(body, context) {
  if (body && Array.isArray(body.messages)) {
    // Example: append a context timestamp or audit tag
    // console.log("[PreRoute] Forwarding request to:", context.model);
  }
  return body;
}`,
    config_schema: [],
  },
  {
    name: "Post-Response Filter & Audit Hook",
    icon: "transform",
    desc: "Intercepts and sanitizes model output payloads before returning to client",
    hook: "post-response",
    category: "middleware",
    id: "post-response-sanitizer",
    skillName: "Post-Response Output Filter",
    description: "Intercepts upstream JSON responses to remove unwanted watermarks or compute audit logs.",
    hook_script: `/**
 * Post-Response Hook
 * Intercepts upstream JSON responses before returning to client.
 */
export async function postResponse(response, context) {
  if (response && response.choices && response.choices[0]?.message?.content) {
    // Example: sanitize or strip unwanted patterns
    // response.choices[0].message.content = response.choices[0].message.content.trim();
  }
  return response;
}`,
    config_schema: [],
  },
  {
    name: "Custom MCP Agent Tool",
    icon: "terminal",
    desc: "Integrate any external CLI or MCP package tool workflow",
    hook: "install-cli",
    category: "agent-skill",
    id: "mcp-custom-tool",
    skillName: "Custom MCP Agent Tool",
    description: "Executes external MCP tool workflows via package manager.",
    install_command: "npm install -g @modelcontextprotocol/inspector",
    uninstall_command: "npm uninstall -g @modelcontextprotocol/inspector",
    source: "https://github.com/modelcontextprotocol/inspector",
    config_schema: [],
  },
];

export default function ExtendedClient() {
  const [skills, setSkills] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [installingSkill, setInstallingSkill] = useState(null);
  const [deletingSkill, setDeletingSkill] = useState(null);
  const [skillToDelete, setSkillToDelete] = useState(null);
  const [syncingEcc, setSyncingEcc] = useState(false);
  const [eccSyncResult, setEccSyncResult] = useState(null);
  const [eccCatalogStats, setEccCatalogStats] = useState({ skillsCount: 286 });

  // Studio Modal State
  const [showStudioModal, setShowStudioModal] = useState(false);
  const [studioTab, setStudioTab] = useState("form"); // 'form' | 'preview'
  const [formHook, setFormHook] = useState("system-prompt");
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formHookScript, setFormHookScript] = useState(DEFAULT_PRE_ROUTE_SCRIPT);
  const [formInstallCmd, setFormInstallCmd] = useState("");
  const [formUpdateCmd, setFormUpdateCmd] = useState("");
  const [formUninstallCmd, setFormUninstallCmd] = useState("");
  const [formConfigs, setFormConfigs] = useState([]);
  
  // Updates State for CLI skills (Graphify, MCP Inspector, etc.)
  const [cliUpdates, setCliUpdates] = useState({});
  const [updatingSkill, setUpdatingSkill] = useState(null);
  const [showHowToUseModal, setShowHowToUseModal] = useState(false);
  const [selectedSkillForGuide, setSelectedSkillForGuide] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, skillsRes, eccRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/skills"),
        fetch("/api/skills/sync-ecc").catch(() => null),
      ]);
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setSettings(s);
      }
      if (skillsRes.ok) {
        const sk = await skillsRes.json();
        setSkills(sk);
        
        // Check updates for all skills with sources (CLI and prompt skills)
        const trackableList = sk.filter((s) => s.version || s.hook === "install-cli" || ["caveman", "ponytail", "rtk", "commit-lint", "watermarks-remover", "taste-skill"].includes(s.id));
        for (const s of trackableList) {
          fetch(`/api/plugins/update-check?plugin=${encodeURIComponent(s.id)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((up) => {
              if (up) {
                setCliUpdates((prev) => ({ ...prev, [s.id]: up }));
              }
            })
            .catch(() => {});
        }
      }
      if (eccRes && eccRes.ok) {
        const eccData = await eccRes.json();
        if (eccData.skillsCount !== undefined) {
          setEccCatalogStats({ skillsCount: eccData.skillsCount });
        }
      }
    } catch (e) {
      console.error("Failed to load extended settings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSyncEccSkills = async () => {
    setSyncingEcc(true);
    setEccSyncResult(null);
    try {
      const res = await fetch("/api/skills/sync-ecc", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setEccCatalogStats({ skillsCount: data.skillsCount });
        setEccSyncResult({ success: true, message: `Synced ${data.skillsCount} skills successfully.` });
      } else {
        setEccSyncResult({ success: false, message: data.error || "Failed to sync" });
      }
    } catch (err) {
      setEccSyncResult({ success: false, message: err.message });
    } finally {
      setSyncingEcc(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const patchSetting = async (delta) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(delta),
      });
    } catch (e) {
      console.error("Failed to patch setting:", e);
    }
  };

  const handleSkillToggle = (skill, value) => {
    const key = skill.legacy_enabled_key || `${skill.id}Enabled`;
    setSettings((prev) => ({ ...prev, [key]: value }));
    patchSetting({ [key]: value });
  };

  const handleSkillConfig = (skill, configKey, value) => {
    const settingKey =
      configKey === "routing_mode"
        ? `${skill.id}RoutingMode`
        : configKey;
    setSettings((prev) => ({ ...prev, [settingKey]: value }));
    patchSetting({ [settingKey]: value });
  };

  const handleInstallSkill = async (skill) => {
    setInstallingSkill(skill.id);
    const key = skill.legacy_enabled_key || `${skill.id}Enabled`;
    const isInstalled = settings[key];
    const action = isInstalled ? "uninstall" : "install";

    try {
      const res = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: skill.id, action }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, [key]: !isInstalled }));
        patchSetting({ [key]: !isInstalled });
      }
    } catch (e) {
      console.error("Failed to toggle install state:", e);
    } finally {
      setInstallingSkill(null);
    }
  };

  const handleUpdateSkill = async (skill) => {
    setUpdatingSkill(skill.id);
    try {
      const res = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: skill.id, action: "update" }),
      });
      if (res.ok) {
        // Re-check update status
        const upRes = await fetch(`/api/plugins/update-check?plugin=${encodeURIComponent(skill.id)}`);
        if (upRes.ok) {
          const up = await upRes.json();
          setCliUpdates((prev) => ({ ...prev, [skill.id]: up }));
        }
      }
    } catch (e) {
      console.error("Failed to update skill:", e);
    } finally {
      setUpdatingSkill(null);
    }
  };

  const handleDeleteSkill = async () => {
    if (!skillToDelete) return;
    setDeletingSkill(skillToDelete.id);
    try {
      const res = await fetch(`/api/skills?id=${encodeURIComponent(skillToDelete.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSkillToDelete(null);
        loadData();
      }
    } catch (e) {
      console.error("Failed to delete skill:", e);
    } finally {
      setDeletingSkill(null);
    }
  };

  const applyTemplate = (tmpl) => {
    setFormHook(tmpl.hook);
    setFormId(tmpl.id);
    setFormName(tmpl.skillName);
    setFormDesc(tmpl.description);
    setFormPrompt(tmpl.prompt || "");
    setFormHookScript(
      tmpl.hook_script ||
      (tmpl.hook === "post-response" ? DEFAULT_POST_RESPONSE_SCRIPT : DEFAULT_PRE_ROUTE_SCRIPT)
    );
    setFormInstallCmd(tmpl.install_command || "");
    setFormUpdateCmd(tmpl.update_command || "");
    setFormUninstallCmd(tmpl.uninstall_command || "");
    setFormSource(tmpl.source || "");
    setFormConfigs(tmpl.config_schema || []);
  };

  const handleAddConfigField = (type = "slider") => {
    const count = formConfigs.length + 1;
    setFormConfigs((prev) => [
      ...prev,
      {
        key: `param_${count}`,
        type: "slider",
        label: `Parameter ${count}`,
        min: 1,
        max: 10,
        default: 5,
      },
    ]);
  };

  const handleRemoveConfigField = (index) => {
    setFormConfigs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateConfigField = (index, field, value) => {
    setFormConfigs((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const generatedManifest = useMemo(() => {
    let category = "prompt-injection";
    if (formHook === "install-cli") category = "agent-skill";
    else if (formHook === "pre-route" || formHook === "post-response" || formHook === "pre-request") category = "middleware";

    const manifest = {
      id: formId.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "custom-skill",
      name: formName || "Custom Skill",
      description: formDesc || "Custom module for 9Router.",
      category,
      hook: formHook,
      default_enabled: true,
      source: formSource || "custom",
    };
    if (formHook === "install-cli") {
      if (formInstallCmd) manifest.install_command = formInstallCmd;
      if (formUpdateCmd) manifest.update_command = formUpdateCmd;
      if (formUninstallCmd) manifest.uninstall_command = formUninstallCmd;
    }
    if (formConfigs.length > 0) {
      manifest.config_schema = formConfigs;
    }
    return manifest;
  }, [formId, formName, formDesc, formHook, formSource, formInstallCmd, formUpdateCmd, formUninstallCmd, formConfigs]);

  const handleSaveSkill = async () => {
    if (!formId || !formName) return;
    try {
      const payload = {
        ...generatedManifest,
        prompt_template: formHook === "system-prompt" ? formPrompt : undefined,
        hook_script: (formHook === "pre-route" || formHook === "post-response") ? formHookScript : undefined,
      };

      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowStudioModal(false);
        setFormId("");
        setFormName("");
        setFormDesc("");
        setFormPrompt("");
        setFormInstallCmd("");
        setFormUpdateCmd("");
        setFormUninstallCmd("");
        setFormSource("");
        setFormConfigs([]);
        loadData();
      }
    } catch (e) {
      console.error("Failed to save skill:", e);
    }
  };

  // Exclude default core token savers & dedicated cards (ECC Auto Skill Router)
  const excludedPromptSkillIds = [
    "rtk",
    "headroom",
    "caveman",
    "ponytail",
    "watermarks-remover",
    "ecc-auto-skill-router",
  ];
  
  const customPromptSkills = skills.filter(
    (s) =>
      !excludedPromptSkillIds.includes(s.id) &&
      (s.hook === "system-prompt" || s.category === "prompt-injection")
  );

  const agentCliSkills = skills.filter(
    (s) => s.hook === "install-cli" || (s.category === "agent-skill" && s.hook !== "system-prompt")
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6">
      {/* Hero Banner with Proper Flex & Wrapping */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-br from-brand-500/10 via-surface to-surface-2 border border-border shadow-xs">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="material-symbols-outlined text-primary text-2xl">auto_awesome</span>
            <h1 className="text-xl font-bold tracking-tight text-text-main truncate">9Router Extended</h1>
            <Badge variant="primary" size="sm">Studio & Registry</Badge>
          </div>
          <p className="text-sm text-text-muted">
            Extend 9Router with custom prompt injectors, interactive parameter sliders, and CLI agent tool integrations.
          </p>
        </div>

        <div className="shrink-0 self-stretch sm:self-center">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowStudioModal(true)}
            className="w-full sm:w-auto whitespace-nowrap px-4 py-2 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Create Custom Skill / Rule</span>
          </Button>
        </div>
      </div>

      {/* ECC Auto Skill Router Card */}
      <Card className="p-6 space-y-5 border-primary/20 bg-surface">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="material-symbols-outlined text-primary text-[22px]">hub</span>
              <h2 className="text-base font-semibold text-text-main">ECC Auto Skill Router</h2>
              <Badge variant="success" size="sm">286 Skills Catalog</Badge>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Auto-classify and inject domain knowledge from 286 ECC skills into requests based on user prompt matching. Zero config, sub-5ms local routing.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncEccSkills}
              disabled={syncingEcc}
              className="flex items-center gap-1.5 text-xs"
            >
              <span className={`material-symbols-outlined text-[16px] ${syncingEcc ? "animate-spin" : ""}`}>
                sync
              </span>
              <span>{syncingEcc ? "Syncing..." : "Sync Catalog"}</span>
            </Button>
            <Toggle
              checked={!!settings.ecc_auto_skill_routerEnabled}
              onChange={() => {
                const nextVal = !settings.ecc_auto_skill_routerEnabled;
                setSettings((prev) => ({ ...prev, ecc_auto_skill_routerEnabled: nextVal }));
                patchSetting({ ecc_auto_skill_routerEnabled: nextVal });
              }}
            />
          </div>
        </div>

        {eccSyncResult && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
              eccSyncResult.success
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-danger/10 text-danger border border-danger/20"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {eccSyncResult.success ? "check_circle" : "error"}
            </span>
            <span>{eccSyncResult.message}</span>
          </div>
        )}

        {/* Sliders when enabled */}
        {settings.ecc_auto_skill_routerEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <ConfigSlider
              label="Confidence Threshold"
              configKey="ecc_auto_skill_routerConfidence"
              value={settings.ecc_auto_skill_routerConfidence !== undefined ? Number(settings.ecc_auto_skill_routerConfidence) : 0.35}
              min={0.1}
              max={0.9}
              step={0.05}
              onChange={(val) => {
                setSettings((prev) => ({ ...prev, ecc_auto_skill_routerConfidence: val }));
                patchSetting({ ecc_auto_skill_routerConfidence: val });
              }}
            />
            <ConfigSlider
              label="Max Skills per Request"
              configKey="ecc_auto_skill_routerMaxSkills"
              value={settings.ecc_auto_skill_routerMaxSkills !== undefined ? Number(settings.ecc_auto_skill_routerMaxSkills) : 1}
              min={1}
              max={3}
              step={1}
              onChange={(val) => {
                setSettings((prev) => ({ ...prev, ecc_auto_skill_routerMaxSkills: val }));
                patchSetting({ ecc_auto_skill_routerMaxSkills: val });
              }}
            />
          </div>
        )}
      </Card>

      {/* Hermes Agent Managed Service Card */}
      <HermesPluginCard />

      {/* Section 1: Custom & Aesthetic Rules */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">palette</span>
            <h2 className="text-base font-semibold text-text-main">Custom Prompt & Aesthetic Rules</h2>
          </div>
          <span className="text-xs text-text-muted font-medium">{customPromptSkills.length} available</span>
        </div>

        {customPromptSkills.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">No custom prompt skills installed yet.</p>
        ) : (
          <div className="space-y-4">
            {customPromptSkills.map((skill) => {
              const enabledKey = skill.legacy_enabled_key || `${skill.id}Enabled`;
              const isEnabled =
                settings[enabledKey] !== undefined ? !!settings[enabledKey] : !!skill.default_enabled;

              return (
                <div
                  key={skill.id}
                  className={`p-5 rounded-xl border border-border transition-all duration-200 ${
                    isEnabled ? "bg-surface-2/60 shadow-xs" : "bg-surface opacity-80"
                  }`}
                >
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
                        <Badge variant="default" size="sm">System Prompt</Badge>
                        {(() => {
                          const up = cliUpdates[skill.id];
                          const currentVer = up?.currentVersion || skill.version;
                          const hasUpdate = up?.hasUpdate;
                          const latestVer = up?.latestVersion;

                          return (
                            <>
                              {currentVer && (
                                <Badge variant="success" size="sm">
                                  v{currentVer.replace(/^v/, "")}
                                </Badge>
                              )}
                              {hasUpdate && (
                                <Badge variant="warning" size="sm" className="animate-pulse">
                                  v{latestVer} available
                                </Badge>
                              )}
                            </>
                          );
                        })()}
                        {skill.source && skill.source !== "custom" && (
                          <a
                            href={skill.source}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary underline hover:opacity-80 inline-flex items-center gap-0.5"
                          >
                            Source
                            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-text-muted leading-relaxed">{skill.description}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                      {cliUpdates[skill.id]?.hasUpdate && (
                        <Button
                          size="sm"
                          variant="warning"
                          onClick={() => handleUpdateSkill(skill)}
                          loading={updatingSkill === skill.id}
                          className="h-8 text-xs font-semibold px-2.5"
                        >
                          Sync Update
                        </Button>
                      )}
                      <Toggle checked={isEnabled} onChange={() => handleSkillToggle(skill, !isEnabled)} />
                      {skill.source === "custom" && (
                        <button
                          type="button"
                          onClick={() => setSkillToDelete(skill)}
                          className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete Custom Skill"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Config Sliders & Enums if enabled */}
                  {isEnabled && skill.config_schema && (
                    <div className="mt-4 pt-4 border-t border-border flex flex-col md:flex-row items-stretch md:items-center gap-4">
                      {skill.config_schema.map((cfg) => {
                        const settingKey =
                          cfg.key === "routing_mode"
                            ? `${skill.id}RoutingMode`
                            : cfg.legacy_key || cfg.key;
                        const val = settings[settingKey] ?? settings[cfg.legacy_key || cfg.key] ?? cfg.default;
                        if (cfg.type === "enum") {
                          const options = cfg.options || [];
                          return (
                            <div key={cfg.key} className="flex flex-col gap-1.5">
                              <span className="text-xs text-text-muted font-medium">
                                {cfg.label || cfg.key}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {options.map((opt) => {
                                  const optVal = opt.value ?? opt.id;
                                  const isSelected = val === optVal;
                                  return (
                                    <button
                                      key={optVal}
                                      type="button"
                                      onClick={() =>
                                        handleSkillConfig(skill, cfg.legacy_key || cfg.key, optVal)
                                      }
                                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                                        isSelected
                                          ? "bg-primary text-white border-primary"
                                          : "bg-surface border-border text-text-muted hover:bg-surface-2"
                                      }`}
                                      title={opt.desc}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }
                        if (cfg.type === "slider") {
                          return (
                            <ConfigSlider
                              key={cfg.key}
                              label={cfg.label}
                              configKey={cfg.key}
                              value={val}
                              min={cfg.min ?? 1}
                              max={cfg.max ?? 10}
                              step={cfg.step ?? 1}
                              onChange={(newVal) =>
                                handleSkillConfig(skill, cfg.legacy_key || cfg.key, newVal)
                              }
                            />
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Section 2: Agent CLI Skills */}
      {agentCliSkills.length > 0 && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">terminal</span>
              <h2 className="text-base font-semibold text-text-main">Agent CLI Tools</h2>
            </div>
            <span className="text-xs text-text-muted font-medium">{agentCliSkills.length} tools</span>
          </div>

          <div className="space-y-4">
            {agentCliSkills.map((skill) => {
              const key = skill.legacy_enabled_key || `${skill.id}Enabled`;
              const isInstalled = !!settings[key];

              return (
                <div
                  key={skill.id}
                  className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-border bg-surface"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
                      <Badge variant="default" size="sm">CLI Module</Badge>
                      {skill.source && skill.source !== "custom" && (
                        <a
                          href={skill.source}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary underline hover:opacity-80 inline-flex items-center gap-0.5"
                        >
                          Source
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">{skill.description}</p>
                    {skill.install_command && (
                      <p className="font-mono text-[11px] text-text-muted bg-surface-2 px-2.5 py-1 rounded-md inline-block border border-border/50">
                        $ {skill.install_command}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                    {(() => {
                      const up = cliUpdates[skill.id];
                      const hasUpdate = up?.hasUpdate;
                      const isUpToDate = up && !up.hasUpdate && up.currentVersion;
                      const autoUpdateKey = `${skill.id.replace(/-/g, "")}AutoUpdate`;
                      const isAutoUpdateEnabled = !!settings[autoUpdateKey];

                      return (
                        <div className="flex items-center gap-2">
                          {isInstalled && (
                            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none mr-1" title="Automatically check and install updates during background watchdog cycles">
                              <input
                                type="checkbox"
                                checked={isAutoUpdateEnabled}
                                onChange={(e) => {
                                  setSettings((prev) => ({ ...prev, [autoUpdateKey]: e.target.checked }));
                                  patchSetting({ [autoUpdateKey]: e.target.checked });
                                }}
                                className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                              />
                              <span>Auto-update</span>
                            </label>
                          )}

                          {hasUpdate && (
                            <Badge variant="warning" size="sm" className="animate-pulse">
                              v{up.latestVersion} available
                            </Badge>
                          )}
                          {isUpToDate && (
                            <Badge variant="success" size="sm">
                              v{up.currentVersion}
                            </Badge>
                          )}

                          {hasUpdate && isInstalled && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleUpdateSkill(skill)}
                              disabled={updatingSkill === skill.id}
                            >
                              {updatingSkill === skill.id ? (
                                "Updating..."
                              ) : (
                                <>
                                  <span className="material-symbols-outlined text-[16px] mr-1">sync</span>
                                  Update
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      );
                    })()}

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedSkillForGuide(skill);
                        setShowHowToUseModal(true);
                      }}
                    >
                      <span className="material-symbols-outlined text-[16px] mr-1">help</span>
                      How to Use
                    </Button>
                    <Button
                      variant={isInstalled ? "danger" : "primary"}
                      size="sm"
                      onClick={() => handleInstallSkill(skill)}
                      disabled={installingSkill === skill.id}
                    >
                      {installingSkill === skill.id ? (
                        "Executing..."
                      ) : isInstalled ? (
                        <>
                          <span className="material-symbols-outlined text-[16px] mr-1">delete</span>
                          Uninstall
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[16px] mr-1">download</span>
                          Install
                        </>
                      )}
                    </Button>
                    {skill.source === "custom" && (
                      <button
                        type="button"
                        onClick={() => setSkillToDelete(skill)}
                        className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer"
                        title="Delete Custom Skill"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Spacious, Beautiful Custom Skill Studio Modal */}
      <Modal
        isOpen={showStudioModal}
        size="full"
        title="Custom Skill & Rule Studio"
        onClose={() => setShowStudioModal(false)}
        footer={
          <div className="flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() => setStudioTab((t) => (t === "form" ? "preview" : "form"))}
              className="text-xs font-semibold text-primary underline inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
            >
              <span className="material-symbols-outlined text-[16px]">
                {studioTab === "form" ? "code" : "edit_note"}
              </span>
              {studioTab === "form" ? "Inspect manifest.json" : "Back to Editor"}
            </button>

            <div className="flex items-center gap-2.5">
              <Button variant="secondary" size="sm" onClick={() => setShowStudioModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveSkill}
                disabled={!formId || !formName}
                className="font-semibold shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px] mr-1">rocket_launch</span>
                Save & Deploy Skill
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Starter Templates Grid */}
          <div className="space-y-2 bg-surface-2/60 p-4 rounded-xl border border-border">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[18px]">auto_fix_high</span>
              <span className="text-xs font-bold uppercase tracking-wider text-text-main">
                Starter Templates (1-Click Fill)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
              {PRESET_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => applyTemplate(tmpl)}
                  className="flex flex-col text-left p-3 rounded-lg border border-border bg-surface hover:border-primary/60 hover:bg-surface-2 transition-all cursor-pointer group shadow-2xs"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-text-main group-hover:text-primary">
                    <span className="material-symbols-outlined text-[16px] text-primary">{tmpl.icon}</span>
                    <span className="truncate">{tmpl.name}</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 line-clamp-2 leading-relaxed">{tmpl.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Tab 1: Form Editor */}
          {studioTab === "form" && (
            <div className="space-y-5">
              {/* Type / Hook Switcher */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  Skill Type & Target Hook
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormHook("system-prompt")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      formHook === "system-prompt"
                        ? "border-primary bg-primary/10 text-text-main ring-1 ring-primary shadow-xs"
                        : "border-border bg-surface text-text-muted hover:text-text-main hover:bg-surface-2"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[24px] text-primary shrink-0 mt-0.5">psychology</span>
                    <div>
                      <div className="font-semibold text-xs text-text-main">System Prompt / Rule</div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Injected directly into system prompt (Claude, OpenAI, Gemini).
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormHook("pre-route")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      formHook === "pre-route"
                        ? "border-primary bg-primary/10 text-text-main ring-1 ring-primary shadow-xs"
                        : "border-border bg-surface text-text-muted hover:text-text-main hover:bg-surface-2"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[24px] text-primary shrink-0 mt-0.5">alt_route</span>
                    <div>
                      <div className="font-semibold text-xs text-text-main">Pre-Route Hook</div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Middleware executing before model resolution & upstream routing.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormHook("post-response")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      formHook === "post-response"
                        ? "border-primary bg-primary/10 text-text-main ring-1 ring-primary shadow-xs"
                        : "border-border bg-surface text-text-muted hover:text-text-main hover:bg-surface-2"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[24px] text-primary shrink-0 mt-0.5">transform</span>
                    <div>
                      <div className="font-semibold text-xs text-text-main">Post-Response Hook</div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Intercepts, sanitizes, or audits model response payloads.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormHook("install-cli")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      formHook === "install-cli"
                        ? "border-primary bg-primary/10 text-text-main ring-1 ring-primary shadow-xs"
                        : "border-border bg-surface text-text-muted hover:text-text-main hover:bg-surface-2"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[24px] text-primary shrink-0 mt-0.5">terminal</span>
                    <div>
                      <div className="font-semibold text-xs text-text-main">Agent CLI Module</div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        CLI tool or MCP package installed on system via package manager.
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-main">Skill Name</label>
                  <Input
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (!formId) {
                        setFormId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                      }
                    }}
                    placeholder="e.g. Clean Architecture Rule"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-main">Unique ID / Folder Name</label>
                  <Input
                    value={formId}
                    onChange={(e) => setFormId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    placeholder="clean-architecture-rule"
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-main">Description</label>
                <Input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Enforces strict clean code separation and domain boundaries."
                />
              </div>

              {/* System Prompt specific: Prompt editor */}
              {formHook === "system-prompt" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-text-main">Prompt Instructions (prompt.txt)</label>
                    <span className="text-[11px] text-text-muted font-mono">Supports {"{param_key}"} variables</span>
                  </div>
                  <textarea
                    value={formPrompt}
                    onChange={(e) => setFormPrompt(e.target.value)}
                    placeholder="When writing code, always follow domain separation..."
                    rows={6}
                    className="w-full p-3.5 rounded-xl border border-border bg-surface text-xs focus:outline-none focus:border-primary font-mono leading-relaxed custom-scrollbar shadow-2xs"
                  />
                </div>
              )}

              {/* Pre-Route / Post-Response Hook Script Editor */}
              {(formHook === "pre-route" || formHook === "post-response") && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-text-main">
                      Hook Implementation (hook.js)
                    </label>
                    <span className="text-[11px] text-text-muted font-mono">
                      {formHook === "pre-route" ? "export async function preRoute(body, context)" : "export async function postResponse(response, context)"}
                    </span>
                  </div>
                  <textarea
                    value={formHookScript}
                    onChange={(e) => setFormHookScript(e.target.value)}
                    rows={8}
                    className="w-full p-3.5 rounded-xl border border-border bg-surface text-xs focus:outline-none focus:border-primary font-mono leading-relaxed custom-scrollbar shadow-2xs"
                  />
                </div>
              )}

              {/* CLI Tool specific: Commands */}
              {formHook === "install-cli" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-surface-2/60 p-4 rounded-xl border border-border">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-main">Install Command</label>
                    <Input
                      value={formInstallCmd}
                      onChange={(e) => setFormInstallCmd(e.target.value)}
                      placeholder="npm install -g @scope/package"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-main">Update Command</label>
                    <Input
                      value={formUpdateCmd}
                      onChange={(e) => setFormUpdateCmd(e.target.value)}
                      placeholder="npm install -g @scope/package@latest"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-main">Uninstall Command</label>
                    <Input
                      value={formUninstallCmd}
                      onChange={(e) => setFormUninstallCmd(e.target.value)}
                      placeholder="npm uninstall -g @scope/package"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Dynamic Config Schema Builder */}
              <div className="space-y-3 bg-surface-2/60 p-4 rounded-xl border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-text-main">
                      Dynamic Config Parameters (config_schema)
                    </span>
                  </div>
                  <Button size="xs" variant="secondary" onClick={() => handleAddConfigField("slider")}>
                    <span className="material-symbols-outlined text-[14px] mr-1">add</span>
                    Add Parameter Slider
                  </Button>
                </div>

                {formConfigs.length === 0 ? (
                  <p className="text-xs text-text-muted italic py-1">
                    No dynamic parameters added. Add sliders (like Design Variance) to let users control this rule interactively.
                  </p>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    {formConfigs.map((cfg, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 bg-surface p-3 rounded-lg border border-border shadow-2xs"
                      >
                        <div className="flex-1">
                          <label className="text-[10px] font-semibold text-text-muted">Label</label>
                          <Input
                            value={cfg.label}
                            onChange={(e) => {
                              handleUpdateConfigField(idx, "label", e.target.value);
                              handleUpdateConfigField(
                                idx,
                                "key",
                                e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")
                              );
                            }}
                            placeholder="e.g. Strictness"
                            className="text-xs"
                          />
                        </div>
                        <div className="w-24">
                          <label className="text-[10px] font-semibold text-text-muted">Key</label>
                          <Input
                            value={cfg.key}
                            onChange={(e) => handleUpdateConfigField(idx, "key", e.target.value)}
                            placeholder="key_name"
                            className="text-xs font-mono"
                          />
                        </div>
                        <div className="w-20">
                          <label className="text-[10px] font-semibold text-text-muted">Default</label>
                          <Input
                            type="number"
                            min={cfg.min || 1}
                            max={cfg.max || 10}
                            value={cfg.default}
                            onChange={(e) => handleUpdateConfigField(idx, "default", parseInt(e.target.value))}
                            className="text-xs font-mono text-center"
                          />
                        </div>
                        <div className="self-end pb-1">
                          <button
                            type="button"
                            onClick={() => handleRemoveConfigField(idx)}
                            className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Live JSON Preview */}
          {studioTab === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>Generated manifest.json</span>
                <span className="font-mono">skills/{formId || "custom-skill"}/manifest.json</span>
              </div>
              <div className="p-4 bg-surface-3 rounded-xl font-mono text-xs text-text-main overflow-x-auto max-h-96 border border-border custom-scrollbar">
                <pre>{JSON.stringify(generatedManifest, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!skillToDelete}
        title="Delete Custom Skill"
        message={`Are you sure you want to permanently delete "${skillToDelete?.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={!!deletingSkill}
        onConfirm={handleDeleteSkill}
        onClose={() => setSkillToDelete(null)}
      />

      {/* How to Use Modal */}
      <Modal
        isOpen={showHowToUseModal}
        size="full"
        title={`How to Use: ${selectedSkillForGuide?.name || ""}`}
        onClose={() => {
          setShowHowToUseModal(false);
          setSelectedSkillForGuide(null);
        }}
        footer={
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setShowHowToUseModal(false);
                setSelectedSkillForGuide(null);
              }}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedSkillForGuide && (
          <div className="space-y-6 text-sm">
            {/* Graphify Guide */}
            {selectedSkillForGuide.id === "graphify" && (
              <>
                <div className="p-4 bg-surface-2 rounded-xl border border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">info</span>
                    <h3 className="font-semibold text-text-main">What is Graphify?</h3>
                  </div>
                  <p className="text-text-muted leading-relaxed">
                    Graphify transforms your entire codebase into a persistent knowledge graph using god nodes, community detection, and semantic relationships. It enables powerful context-aware queries about your project architecture.
                  </p>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">play_circle</span>
                    Installation & Setup
                  </h3>
                  <ol className="list-decimal list-inside space-y-2 text-text-muted ml-2">
                    <li>Click the <strong className="text-text-main">Install</strong> button above (executes: <code className="text-xs bg-surface-2 px-2 py-0.5 rounded font-mono">uv tool install graphifyy && graphify install</code>)</li>
                    <li>Wait for installation to complete (~30 seconds)</li>
                    <li>Toggle switch turns green when ready</li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                    Usage in AI Agent CLI
                  </h3>
                  <div className="bg-surface-3 p-4 rounded-xl space-y-3 border border-border">
                    <p className="text-text-muted"><strong className="text-text-main">Option 1:</strong> Use the <code className="text-xs bg-surface px-2 py-0.5 rounded font-mono text-primary">/graphify</code> command</p>
                    <pre className="text-xs font-mono text-text-main bg-surface p-3 rounded-lg overflow-x-auto border border-border">
{`/graphify`}
                    </pre>

                    <p className="text-text-muted"><strong className="text-text-main">Option 2:</strong> Ask natural language questions</p>
                    <pre className="text-xs font-mono text-text-main bg-surface p-3 rounded-lg overflow-x-auto border border-border">
{`Explain the architecture of this codebase using graphify

What are the main modules and their relationships?

Show me the dependency graph for the authentication system`}
                    </pre>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">integration_instructions</span>
                    Integration with CLI Tools
                  </h3>
                  <p className="text-text-muted leading-relaxed">
                    Once installed, Graphify automatically works with any AI agent connected to 9Router:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 text-text-muted ml-2">
                    <li><strong className="text-text-main">Claude Code</strong> → Navigate to <span className="text-primary">/dashboard/cli-tools</span> → Configure Claude Code with 9Router endpoint</li>
                    <li><strong className="text-text-main">Cline</strong> → Set API endpoint to <code className="text-xs bg-surface-2 px-2 py-0.5 rounded font-mono">http://localhost:20128/v1</code></li>
                    <li><strong className="text-text-main">Roo Code</strong> → Configure via CLI Tools page</li>
                    <li><strong className="text-text-main">Codex</strong> → Auto-detects 9Router when running locally</li>
                  </ul>
                </div>

                {selectedSkillForGuide.source && (
                  <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
                    <a
                      href={selectedSkillForGuide.source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-2 text-xs font-medium"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      View Official Documentation
                    </a>
                  </div>
                )}
              </>
            )}

            {/* MCP Inspector Guide */}
            {selectedSkillForGuide.id === "mcp-inspector" && (
              <>
                <div className="p-4 bg-surface-2 rounded-xl border border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">info</span>
                    <h3 className="font-semibold text-text-main">What is MCP Inspector?</h3>
                  </div>
                  <p className="text-text-muted leading-relaxed">
                    The Model Context Protocol Inspector is a browser-based UI testing and debugging tool for MCP servers. It lets you interactively test tools, resources, and prompts without needing an AI agent.
                  </p>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">play_circle</span>
                    Installation & Setup
                  </h3>
                  <ol className="list-decimal list-inside space-y-2 text-text-muted ml-2">
                    <li>Click the <strong className="text-text-main">Install</strong> button above (executes: <code className="text-xs bg-surface-2 px-2 py-0.5 rounded font-mono">npm install -g @modelcontextprotocol/inspector</code>)</li>
                    <li>Installation completes in ~15 seconds</li>
                    <li>Toggle turns green when ready</li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                    Usage in Terminal
                  </h3>
                  <div className="bg-surface-3 p-4 rounded-xl space-y-3 border border-border">
                    <p className="text-text-muted"><strong className="text-text-main">Basic Usage:</strong> Launch Inspector with any MCP server</p>
                    <pre className="text-xs font-mono text-text-main bg-surface p-3 rounded-lg overflow-x-auto border border-border">
{`npx @modelcontextprotocol/inspector <your-mcp-server-command>`}
                    </pre>

                    <p className="text-text-muted"><strong className="text-text-main">Example 1:</strong> Test SQLite MCP Server</p>
                    <pre className="text-xs font-mono text-text-main bg-surface p-3 rounded-lg overflow-x-auto border border-border">
{`npx @modelcontextprotocol/inspector \\
  npx -y @modelcontextprotocol/server-sqlite \\
  --db-path ./mydb.sqlite`}
                    </pre>

                    <p className="text-text-muted"><strong className="text-text-main">Example 2:</strong> Test Filesystem MCP Server</p>
                    <pre className="text-xs font-mono text-text-main bg-surface p-3 rounded-lg overflow-x-auto border border-border">
{`npx @modelcontextprotocol/inspector \\
  npx -y @modelcontextprotocol/server-filesystem \\
  /path/to/allowed/files`}
                    </pre>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">web</span>
                    Web UI Features
                  </h3>
                  <p className="text-text-muted leading-relaxed">
                    Inspector opens at <code className="text-xs bg-surface-2 px-2 py-0.5 rounded font-mono text-primary">http://localhost:5173</code> with:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 text-text-muted ml-2">
                    <li><strong className="text-text-main">Tools Tab</strong> → Test all available MCP tools with custom parameters</li>
                    <li><strong className="text-text-main">Resources Tab</strong> → Browse and read MCP resources (files, databases, APIs)</li>
                    <li><strong className="text-text-main">Prompts Tab</strong> → Test prompt templates with argument injection</li>
                    <li><strong className="text-text-main">Console Logs</strong> → Real-time JSON-RPC message inspection</li>
                  </ul>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">lightbulb</span>
                    Pro Tips
                  </h3>
                  <ul className="list-disc list-inside space-y-1.5 text-text-muted ml-2">
                    <li>Use Inspector to <strong className="text-text-main">validate MCP servers before connecting to AI agents</strong></li>
                    <li>Debug tool schema mismatches and permission errors in real-time</li>
                    <li>Copy working tool invocations from Inspector to agent prompts</li>
                    <li>Monitor JSON-RPC traffic to understand MCP protocol flow</li>
                  </ul>
                </div>

                {selectedSkillForGuide.source && (
                  <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
                    <a
                      href={selectedSkillForGuide.source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-2 text-xs font-medium"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      View Official MCP Inspector Docs
                    </a>
                  </div>
                )}
              </>
            )}

            {/* Generic CLI Tool Guide */}
            {selectedSkillForGuide.id !== "graphify" && selectedSkillForGuide.id !== "mcp-inspector" && (
              <>
                <div className="p-4 bg-surface-2 rounded-xl border border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">info</span>
                    <h3 className="font-semibold text-text-main">About This Tool</h3>
                  </div>
                  <p className="text-text-muted leading-relaxed">
                    {selectedSkillForGuide.description}
                  </p>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-text-main flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">play_circle</span>
                    Installation
                  </h3>
                  <ol className="list-decimal list-inside space-y-2 text-text-muted ml-2">
                    <li>Click the <strong className="text-text-main">Install</strong> button in the card above</li>
                    {selectedSkillForGuide.install_command && (
                      <li className="ml-6">
                        Executes: <code className="text-xs bg-surface-2 px-2 py-0.5 rounded font-mono">{selectedSkillForGuide.install_command}</code>
                      </li>
                    )}
                    <li>Wait for installation to complete</li>
                    <li>Tool becomes available globally in your terminal</li>
                  </ol>
                </div>

                {selectedSkillForGuide.source && selectedSkillForGuide.source !== "custom" && (
                  <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
                    <a
                      href={selectedSkillForGuide.source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-2 text-xs font-medium"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      View Official Documentation
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

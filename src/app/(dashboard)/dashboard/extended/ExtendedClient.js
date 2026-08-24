"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, Toggle, Badge, Modal, Input, ConfigSlider, ConfirmModal } from "@/shared/components";

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

  // Studio Modal State
  const [showStudioModal, setShowStudioModal] = useState(false);
  const [studioTab, setStudioTab] = useState("form"); // 'form' | 'preview'
  const [formHook, setFormHook] = useState("system-prompt"); // 'system-prompt' | 'install-cli'
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formInstallCmd, setFormInstallCmd] = useState("");
  const [formUninstallCmd, setFormUninstallCmd] = useState("");
  const [formConfigs, setFormConfigs] = useState([]);

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, skillsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/skills"),
      ]);
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setSettings(s);
      }
      if (skillsRes.ok) {
        const sk = await skillsRes.json();
        setSkills(sk);
      }
    } catch (e) {
      console.error("Failed to load extended settings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

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
    setSettings((prev) => ({ ...prev, [configKey]: value }));
    patchSetting({ [configKey]: value });
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
    setFormInstallCmd(tmpl.install_command || "");
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
    const manifest = {
      id: formId.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "custom-skill",
      name: formName || "Custom Skill",
      description: formDesc || "Custom module for 9Router.",
      category: formHook === "install-cli" ? "agent-skill" : "prompt-injection",
      hook: formHook,
      default_enabled: true,
      source: formSource || "custom",
    };
    if (formHook === "install-cli") {
      if (formInstallCmd) manifest.install_command = formInstallCmd;
      if (formUninstallCmd) manifest.uninstall_command = formUninstallCmd;
    }
    if (formConfigs.length > 0) {
      manifest.config_schema = formConfigs;
    }
    return manifest;
  }, [formId, formName, formDesc, formHook, formSource, formInstallCmd, formUninstallCmd, formConfigs]);

  const handleSaveSkill = async () => {
    if (!formId || !formName) return;
    try {
      const payload = {
        ...generatedManifest,
        prompt_template: formHook === "system-prompt" ? formPrompt : undefined,
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
        setFormUninstallCmd("");
        setFormSource("");
        setFormConfigs([]);
        loadData();
      }
    } catch (e) {
      console.error("Failed to save skill:", e);
    }
  };

  // Exclude default core token savers which belong to Token Saver
  const defaultTokenSaverIds = ["rtk", "headroom", "caveman", "ponytail", "watermarks-remover"];
  
  const customPromptSkills = skills.filter(
    (s) =>
      !defaultTokenSaverIds.includes(s.id) &&
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

                  {/* Config Sliders if enabled */}
                  {isEnabled && skill.config_schema && (
                    <div className="mt-4 pt-4 border-t border-border flex flex-col md:flex-row items-stretch md:items-center gap-4">
                      {skill.config_schema.map((cfg) => {
                        const val = settings[cfg.legacy_key || cfg.key] ?? cfg.default;
                        if (cfg.type === "slider") {
                          return (
                            <ConfigSlider
                              key={cfg.key}
                              label={cfg.label}
                              configKey={cfg.key}
                              value={val}
                              min={cfg.min ?? 1}
                              max={cfg.max ?? 10}
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
                      <div className="font-semibold text-xs text-text-main">System Prompt / Rule Injector</div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Injected directly before model execution (Claude, OpenAI, Gemini, Codex).
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

              {/* CLI Tool specific: Commands */}
              {formHook === "install-cli" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-surface-2/60 p-4 rounded-xl border border-border">
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
    </div>
  );
}

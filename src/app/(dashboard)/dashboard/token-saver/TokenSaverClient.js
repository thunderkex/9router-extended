"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Input, Modal, Toggle, ConfirmModal, ConfigSlider, Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";

export default function TokenSaverClient() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomTimeoutMs, setHeadroomTimeoutMs] = useState(3000);
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [headroomExtras, setHeadroomExtras] = useState({
    version: null,
    extras: { code: false, ml: false },
    available: ["code", "ml"],
    loading: false,
  });
  const [pendingExtras, setPendingExtras] = useState([]);
  const [extrasActionLoading, setExtrasActionLoading] = useState(false);
  const [extrasActionError, setExtrasActionError] = useState("");
  const [removingExtra, setRemovingExtra] = useState(null);
  const [installLog, setInstallLog] = useState("");
  const [extrasConfirm, setExtrasConfirm] = useState(null);
  const [autoSetupLoading, setAutoSetupLoading] = useState(false);
  const [autoDetectLoading, setAutoDetectLoading] = useState(false);
  const [autoSetupMessage, setAutoSetupMessage] = useState("");
  const [codeAware, setCodeAware] = useState(false);
  const [kompress, setKompress] = useState(true);
  const [restartingProxy, setRestartingProxy] = useState(false);
  const logPollRef = useRef(null);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [pxpipeEnabled, setPxpipeEnabled] = useState(false);
  const [pxpipeMinChars, setPxpipeMinChars] = useState(25000);
  const [pxpipeStatus, setPxpipeStatus] = useState({
    installed: false,
    installing: false,
    running: false,
    version: null,
    loading: true,
  });
  const [pxpipeHealth, setPxpipeHealth] = useState(null);
  const [showPxpipeModal, setShowPxpipeModal] = useState(false);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");
  const [tokenSaverEnabled, setTokenSaverEnabled] = useState(false);
  const [tokenSaverBudget, setTokenSaverBudget] = useState(80000);
  const [locale, setLocale] = useState("en");
  const [settings, setSettings] = useState({});
  const [skills, setSkills] = useState([]);
  const [installingSkill, setInstallingSkill] = useState(null);
  const [headroomUpdateInfo, setHeadroomUpdateInfo] = useState(null);
  const [headroomUpdating, setHeadroomUpdating] = useState(false);
  const [pxpipeUpdateInfo, setPxpipeUpdateInfo] = useState(null);
  const [pxpipeUpdating, setPxpipeUpdating] = useState(false);
  const [skillsUpdates, setSkillsUpdates] = useState({});
  const [syncingSkill, setSyncingSkill] = useState(null);

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleCavemanLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
    if (current?.wenyan && !isWenyanLocale) {
      setCavemanLevel("ultra");
      patchSetting({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, cavemanLevel]);

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating setting:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleHeadroomEnabled = (value) => {
    const nextUrl = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(nextUrl);
    setHeadroomEnabled(value);
    patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleHeadroomUrlBlur = async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  };

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setHeadroomStatus({ ...data, loading: false });
      if (!data?.installed) {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
        return;
      }
      try {
        const er = await fetch("/api/headroom/extras", {
          headers: { "Cache-Control": "no-store" },
        });
        if (!er.ok) throw new Error("extras status failed");
        const ed = await er.json();
        setHeadroomExtras((s) => ({
          ...s,
          version: ed.version ?? null,
          extras: ed.extras || { code: false, ml: false },
          available: ed.available || ["code", "ml"],
          loading: false,
        }));
        setPendingExtras([]);
      } catch {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
      }
    } catch {
      setHeadroomStatus({
        installed: false,
        running: false,
        python: null,
        loading: false,
      });
      setHeadroomExtras({
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      });
      setPendingExtras([]);
    }
  }, []);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start proxy");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionLoading(true);
    try {
      await fetch("/api/headroom/stop", { method: "POST" });
      await refreshHeadroomStatus();
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  // Poll the install log tail while a pip install/uninstall is running.
  const startLogPolling = useCallback(() => {
    setInstallLog("");
    if (logPollRef.current) clearInterval(logPollRef.current);
    const tick = async () => {
      try {
        const r = await fetch("/api/headroom/extras?log=1", {
          headers: { "Cache-Control": "no-store" },
        });
        const d = await r.json().catch(() => ({}));
        if (typeof d.log === "string") setInstallLog(d.log);
      } catch { /* ignore transient poll errors */ }
    };
    tick();
    logPollRef.current = setInterval(tick, 1500);
  }, []);

  const stopLogPolling = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current);
      logPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopLogPolling(), [stopLogPolling]);

  const handleAutoSetupHeadroom = useCallback(async () => {
    setAutoSetupLoading(true);
    setHeadroomActionError("");
    setAutoSetupMessage("Installing headroom-ai[proxy] and launching proxy daemon...");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/auto-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: ["code"] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "1-Click auto setup failed");
      if (data.url) {
        setHeadroomUrl(data.url);
      }
      setHeadroomEnabled(true);
      setAutoSetupMessage("Headroom is up and running!");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
      setAutoSetupMessage("");
    } finally {
      stopLogPolling();
      setAutoSetupLoading(false);
    }
  }, [refreshHeadroomStatus, startLogPolling, stopLogPolling]);

  const handleAutoDetectPort = useCallback(async () => {
    setAutoDetectLoading(true);
    setHeadroomActionError("");
    try {
      const res = await fetch("/api/headroom/detect-port", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.found && data.url) {
        setHeadroomUrl(data.url);
        await refreshHeadroomStatus();
      } else {
        setHeadroomActionError("No running Headroom instance found on ports 8787-8791.");
      }
    } catch (e) {
      setHeadroomActionError(e.message || "Failed to auto-detect port");
    } finally {
      setAutoDetectLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const togglePendingExtra = (extra) => {
    setPendingExtras((cur) =>
      cur.includes(extra) ? cur.filter((e) => e !== extra) : [...cur, extra]
    );
  };

  const installExtrasConfirmed = useCallback(async () => {
    if (pendingExtras.length === 0) return;
    setExtrasActionLoading(true);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: pendingExtras }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Install failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
      setPendingExtras([]);
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setExtrasActionLoading(false);
    }
  }, [pendingExtras, startLogPolling, stopLogPolling]);

  const removeExtraConfirmed = useCallback(async (extra) => {
    setRemovingExtra(extra);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: [extra] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setRemovingExtra(null);
    }
  }, [startLogPolling, stopLogPolling]);

  const handleInstallExtras = useCallback(() => {
    if (pendingExtras.length === 0) return;
    // Warn about the heavy ~1GB torch download before installing [ml].
    if (pendingExtras.includes("ml")) {
      setExtrasConfirm({
        title: "Install [ml]",
        message: "[ml] downloads ~1 GB (torch + huggingface-hub). Continue?",
        confirmText: "Install",
        variant: "primary",
        onConfirm: installExtrasConfirmed,
      });
      return;
    }
    installExtrasConfirmed();
  }, [pendingExtras, installExtrasConfirmed]);

  const handleRemoveExtra = useCallback((extra) => {
    setExtrasConfirm({
      title: `Remove [${extra}]`,
      message: `Remove [${extra}] and its packages?`,
      confirmText: "Remove",
      variant: "danger",
      onConfirm: () => removeExtraConfirmed(extra),
    });
  }, [removeExtraConfirmed]);

  // Toggle an extra's active state (persist setting), then restart the proxy so
  // the new --code-aware / --disable-kompress flags take effect.
  const toggleExtraActive = useCallback(async (extra, value) => {
    setExtrasActionError("");
    if (extra === "code") setCodeAware(value);
    if (extra === "ml") setKompress(value);
    const key = extra === "code" ? "headroomCodeAware" : "headroomKompress";
    await patchSetting({ [key]: value });
    if (!headroomStatus.running) return;
    setRestartingProxy(true);
    try {
      const res = await fetch("/api/headroom/restart", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restart failed");
      await refreshHeadroomStatus();
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      setRestartingProxy(false);
    }
  }, [headroomStatus.running, refreshHeadroomStatus]);

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const refreshPxpipeStatus = useCallback(async () => {
    setPxpipeStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/pxpipe/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setPxpipeStatus({ ...data, loading: false });
      if (typeof data.minChars === "number") setPxpipeMinChars(data.minChars);
    } catch {
      setPxpipeStatus({ installed: false, installing: false, running: false, version: null, loading: false });
    }
  }, []);

  const runPxpipeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/health", { method: "POST" });
      setPxpipeHealth(await res.json());
    } catch (e) {
      setPxpipeHealth({ healthy: false, checks: [], error: e.message });
    }
  }, []);

  const pxpipeAction = useCallback(
    async (endpoint) => {
      setPxpipeActionError("");
      setPxpipeActionLoading(true);
      try {
        const res = await fetch(`/api/pxpipe/${endpoint}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `PXPIPE ${endpoint} failed`);
        await refreshPxpipeStatus();
        await runPxpipeHealth();
      } catch (e) {
        setPxpipeActionError(e.message);
      } finally {
        setPxpipeActionLoading(false);
      }
    },
    [refreshPxpipeStatus, runPxpipeHealth]
  );

  const handlePxpipeEnabled = (value) => {
    setPxpipeEnabled(value);
    patchSetting({ pxpipeEnabled: value });
  };

  const handlePxpipeMinCharsBlur = () => {
    const next = Math.max(0, Number(pxpipeMinChars) || 25000);
    setPxpipeMinChars(next);
    patchSetting({ pxpipeMinChars: next });
  };

  const handleTokenSaverToggle = (value) => {
    setTokenSaverEnabled(value);
    patchSetting({ tokenSaverEnabled: value });
  };

  const handleTokenSaverBudgetBlur = () => {
    const next = Math.max(1000, Number(tokenSaverBudget) || 80000);
    setTokenSaverBudget(next);
    patchSetting({ tokenSaverBudget: next });
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setHeadroomEnabled(!!data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || "http://localhost:8787");
          if (typeof data.headroomTimeoutMs === "number") setHeadroomTimeoutMs(data.headroomTimeoutMs);
          setCodeAware(data.headroomCodeAware === true);
          setKompress(data.headroomKompress !== false);
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          setPxpipeEnabled(!!data.pxpipeEnabled);
          if (typeof data.pxpipeMinChars === "number") setPxpipeMinChars(data.pxpipeMinChars);
          setTokenSaverEnabled(!!data.tokenSaverEnabled);
          if (typeof data.tokenSaverBudget === "number") setTokenSaverBudget(data.tokenSaverBudget);
          setSettings(data);
          refreshHeadroomStatus();
          refreshPxpipeStatus().then(runPxpipeHealth);
        }
      } catch {}
    };

    const loadSkills = async () => {
      try {
        const res = await fetch("/api/skills");
        if (res.ok) {
          const data = await res.json();
          setSkills(data);

          // Check updates for prompt/rule skills on Token Saver page
          const list = ["caveman", "ponytail", "rtk", "watermarks-remover"];
          for (const id of list) {
            fetch(`/api/plugins/update-check?plugin=${encodeURIComponent(id)}`)
              .then((r) => r.ok ? r.json() : null)
              .then((up) => {
                if (up) setSkillsUpdates((prev) => ({ ...prev, [id]: up }));
              })
              .catch(() => {});
          }
        }
      } catch {}
    };

    loadSettings();
    loadSkills();
    checkHeadroomUpdate();
    checkPxpipeUpdate();
  }, [refreshHeadroomStatus, refreshPxpipeStatus, runPxpipeHealth]);

  const checkHeadroomUpdate = async () => {
    try {
      const res = await fetch("/api/plugins/update-check?plugin=headroom");
      if (res.ok) {
        const data = await res.json();
        setHeadroomUpdateInfo(data);
      }
    } catch {}
  };

  const handleHeadroomUpdate = async () => {
    if (!headroomStatus.installed || headroomUpdating) return;
    setHeadroomUpdating(true);
    try {
      const res = await fetch("/api/headroom/update", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        await refreshHeadroomStatus();
        await checkHeadroomUpdate();
      } else {
        alert(data.error || "Headroom update failed");
      }
    } catch (e) {
      alert("Headroom update error: " + e.message);
    } finally {
      setHeadroomUpdating(false);
    }
  };

  const checkPxpipeUpdate = async () => {
    try {
      const res = await fetch("/api/plugins/update-check?plugin=pxpipe");
      if (res.ok) {
        const data = await res.json();
        setPxpipeUpdateInfo(data);
      }
    } catch {}
  };

  const handleSyncPromptSkill = async (skillId) => {
    setSyncingSkill(skillId);
    try {
      const res = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: skillId, action: "update" }),
      });
      if (res.ok) {
        const upRes = await fetch(`/api/plugins/update-check?plugin=${encodeURIComponent(skillId)}`);
        if (upRes.ok) {
          const up = await upRes.json();
          setSkillsUpdates((prev) => ({ ...prev, [skillId]: up }));
        }
      }
    } catch (e) {
      console.error("Failed to sync skill:", e);
    } finally {
      setSyncingSkill(null);
    }
  };

  const handlePxpipeUpdate = async () => {
    if (!pxpipeStatus.installed || pxpipeUpdating) return;
    setPxpipeUpdating(true);
    try {
      const res = await fetch("/api/pxpipe/update", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        await refreshPxpipeStatus();
        await checkPxpipeUpdate();
      } else {
        alert(data.error || "PXPIPE update failed");
      }
    } catch (e) {
      alert("PXPIPE update error: " + e.message);
    } finally {
      setPxpipeUpdating(false);
    }
  };

  const handleSkillToggle = (skill, value) => {
    const key = skill.legacy_enabled_key || `${skill.id}Enabled`;
    setSettings(prev => ({ ...prev, [key]: value }));
    patchSetting({ [key]: value });
    if (skill.id === "rtk") handleRtkEnabled(value);
    if (skill.id === "headroom") handleHeadroomEnabled(value);
    if (skill.id === "caveman") handleCavemanEnabled(value);
    if (skill.id === "ponytail") handlePonytailEnabled(value);
  };

  const handleSkillConfig = (skill, configKey, value) => {
    const key = configKey;
    setSettings(prev => ({ ...prev, [key]: value }));
    patchSetting({ [key]: value });
    if (skill.id === "caveman" && configKey === "cavemanLevel") handleCavemanLevel(value);
    if (skill.id === "ponytail" && configKey === "ponytailLevel") handlePonytailLevel(value);
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
        body: JSON.stringify({ id: skill.id, action })
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, [key]: !isInstalled }));
        patchSetting({ [key]: !isInstalled });
      } else {
        const data = await res.json();
        alert(`Failed to ${action} ${skill.name}: ${data.error || "Unknown error"}`);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
    setInstallingSkill(null);
  };

  const DEFAULT_TOKEN_SAVER_SKILLS = [
    {
      id: "rtk",
      name: "RTK",
      description: "Compress tool output (git/grep/ls/tree/logs → 60-90% fewer input tokens)",
      source: "https://github.com/rtk-ai/rtk",
      version: "0.46.0",
      default_enabled: true,
      legacy_enabled_key: "rtkEnabled",
    },
    {
      id: "headroom",
      name: "Headroom",
      description: "Compress context via external /v1/compress proxy before routing to the model",
      source: "https://github.com/chopratejas/headroom",
      version: "0.1.0",
      default_enabled: false,
      legacy_enabled_key: "headroomEnabled",
      config_schema: [
        {
          key: "endpoint",
          label: "Proxy URL",
          type: "string",
          default: "http://localhost:8787",
          legacy_key: "headroomUrl",
        },
      ],
    },
    {
      id: "caveman",
      name: "Caveman",
      description: "Terse-style system prompt → ~65% fewer output tokens (up to 87%)",
      source: "https://github.com/caveman-ai/caveman",
      version: "2.4.0",
      default_enabled: false,
      legacy_enabled_key: "cavemanEnabled",
      config_schema: [
        {
          key: "cavemanLevel",
          type: "enum",
          default: "full",
          legacy_key: "cavemanLevel",
          options: [
            { id: "lite", label: "Lite", desc: "Brief, concise answers" },
            { id: "full", label: "Full", desc: "Short sentences, minimal filler" },
            { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
          ],
        },
      ],
    },
    {
      id: "ponytail",
      name: "Ponytail",
      description: "Bias the model toward minimal code: YAGNI, reuse stdlib, deletion over addition",
      source: "https://github.com/ponytail-ai/ponytail",
      version: "4.9.0",
      default_enabled: false,
      legacy_enabled_key: "ponytailEnabled",
      config_schema: [
        {
          key: "ponytailLevel",
          type: "enum",
          default: "full",
          legacy_key: "ponytailLevel",
          options: [
            { id: "lite", label: "Lite", desc: "YAGNI nudges" },
            { id: "full", label: "Full", desc: "Minimal code bias" },
            { id: "ultra", label: "Ultra", desc: "YAGNI extremist, deletion first" },
          ],
        },
      ],
    },
    {
      id: "watermarks-remover",
      name: "Watermarks Remover",
      description: "Strip AI provenance marks (invisible Unicode, C2PA) and AI transition clichés from outputs.",
      source: "https://github.com/9router/watermarks-remover",
      version: "0.6.0",
      default_enabled: false,
      legacy_enabled_key: "watermarksRemoverEnabled",
    },
  ];

  const tokenSaverIds = ["rtk", "headroom", "caveman", "ponytail", "watermarks-remover"];
  const requestPipelineSkills = DEFAULT_TOKEN_SAVER_SKILLS.map((def) => {
    const fromApi = skills.find((s) => s.id === def.id);
    return fromApi ? { ...def, ...fromApi } : def;
  });

  const headroomRunning = !!headroomStatus.running;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : headroomStatus.localUrl !== false && !headroomStatus.installed
        ? "Not installed"
        : headroomStatus.localUrl !== false
          ? "Stopped"
          : "External";
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;

  const pxpipeHealthy = pxpipeHealth?.healthy === true;
  const pxpipeStatusLabel = pxpipeStatus.loading
    ? "Checking…"
    : pxpipeStatus.installing
      ? "Installing…"
      : !pxpipeStatus.installed
        ? "Not installed"
        : pxpipeHealthy
          ? "Healthy"
          : pxpipeStatus.running
            ? "Running"
            : "Stopped";
  const pxpipeChipClass =
    pxpipeHealthy || pxpipeStatus.running
      ? "bg-success/15 text-success"
      : "bg-warning/15 text-warning";

  return (
    <div className="space-y-6 p-6">
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">bolt</span>
            Token Saver
          </h2>
        </div>
        
        {requestPipelineSkills.map((skill, index) => {
          const enabled = settings[skill.legacy_enabled_key || `${skill.id}Enabled`];
          const isEnabled = skill.id === "rtk" ? rtkEnabled : 
                            skill.id === "headroom" ? headroomEnabled :
                            skill.id === "caveman" ? cavemanEnabled :
                            skill.id === "ponytail" ? ponytailEnabled : 
                            (enabled !== undefined ? !!enabled : !!skill.default_enabled);
                            
          return (
            <React.Fragment key={skill.id}>
              <div className={`flex items-center justify-between py-4 gap-4 flex-wrap ${index > 0 ? "border-t border-border mt-4" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-medium">
                      {skill.name}{" "}
                      <a href={skill.source} target="_blank" rel="noreferrer" className="text-xs font-normal text-primary underline hover:opacity-80">(Source)</a>
                    </p>
                    {(() => {
                      if (skill.id === "headroom") {
                        const ver = headroomUpdateInfo?.currentVersion || headroomExtras?.version || skill.version;
                        return ver ? (
                          <Badge variant="success" size="sm">
                            v{ver.replace(/^v/, "")}
                          </Badge>
                        ) : null;
                      }
                      const up = skillsUpdates[skill.id];
                      const currentVer = up?.currentVersion || skill.version;
                      const hasUpdate = up?.hasUpdate;
                      const latestVer = up?.latestVersion;

                      if (!currentVer) return null;
                      return (
                        <div className="flex items-center gap-2">
                          <Badge variant="success" size="sm">
                            v{currentVer.replace(/^v/, "")}
                          </Badge>
                          {hasUpdate && (
                            <div className="flex items-center gap-1.5">
                              <Badge variant="warning" size="sm" className="animate-pulse">
                                v{latestVer} available
                              </Badge>
                              <button
                                type="button"
                                onClick={() => handleSyncPromptSkill(skill.id)}
                                disabled={syncingSkill === skill.id}
                                className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 transition-colors"
                              >
                                {syncingSkill === skill.id ? "Syncing…" : "Sync"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {skill.id === "headroom" && (
                      <>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${headroomRunning ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                          {headroomStatusLabel}
                        </span>
                        {headroomStatus.installed && headroomUpdateInfo?.updateAvailable && (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="warning" size="sm" className="animate-pulse">
                              Update: v{headroomUpdateInfo.latestVersion}
                            </Badge>
                            <button
                              type="button"
                              onClick={handleHeadroomUpdate}
                              disabled={headroomUpdating}
                              className="px-2 py-0.5 rounded text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                              {headroomUpdating ? "Updating…" : "Update"}
                            </button>
                          </div>
                        )}
                        {!headroomRunning && headroomStatus.python && !headroomStatus.installed && (
                          <button
                            type="button"
                            onClick={handleAutoSetupHeadroom}
                            disabled={autoSetupLoading}
                            className="px-2 py-0.5 rounded text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            {autoSetupLoading ? "Setting up…" : "⚡ 1-Click Auto Setup"}
                          </button>
                        )}
                        {!headroomRunning && headroomStatus.installed && (
                          <button
                            type="button"
                            onClick={handleHeadroomStart}
                            disabled={headroomActionLoading}
                            className="px-2 py-0.5 rounded text-xs font-medium border border-border hover:bg-surface-2 disabled:opacity-50 transition-colors"
                          >
                            {headroomActionLoading ? "Starting…" : "Start"}
                          </button>
                        )}
                        <button type="button" onClick={() => setShowHeadroomInstallModal(true)} className="text-xs text-primary underline hover:opacity-80">
                          {headroomRunning ? "Manage" : "Setup"}
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mt-1">{skill.description}</p>
                </div>
                
                <div className="flex items-center gap-3 shrink-0">
                  {isEnabled && skill.config_schema && (
                    <div className="flex flex-col items-end gap-1">
                      {skill.config_schema.map(cfg => {
                        const val = settings[cfg.legacy_key || cfg.key] || cfg.default;
                        if (cfg.type === "enum") {
                          const activeLevel = skill.id === "caveman" ? cavemanLevel : skill.id === "ponytail" ? ponytailLevel : val;
                          const options = skill.id === "caveman" ? visibleCavemanLevels : cfg.options;
                          return (
                            <div key={cfg.key} className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1.5">
                                {options.map(opt => (
                                  <button key={opt.id || opt.value} onClick={() => handleSkillConfig(skill, cfg.legacy_key || cfg.key, opt.id || opt.value)} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${activeLevel === (opt.id || opt.value) ? "bg-primary text-white border-primary" : "bg-transparent border-border text-text-muted hover:bg-surface-2"}`} title={opt.desc}>
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-primary">{options.find(o => (o.id || o.value) === activeLevel)?.desc}</p>
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
                  <Toggle checked={isEnabled} onChange={() => handleSkillToggle(skill, !isEnabled)} />
                </div>
              </div>
              
              {skill.id === "headroom" && headroomStatus.installed && (
                 <div className="mb-3 ml-1 pl-3 pb-4 border-l-2 border-border">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm">Pass IDE context files to proxy</p>
                    <Toggle checked={codeAware} onChange={() => toggleExtraActive("code", !codeAware)} />
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2 mt-4">
                    <p className="text-sm">Compress user messages</p>
                    <Toggle checked={kompress} onChange={() => toggleExtraActive("ml", !kompress)} />
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </Card>

      {/* Context Window Trimmer & Prompt Dedup */}
      <Card id="trimmer">
        <div className="flex items-center justify-between py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">content_cut</span>
                Sliding-Window Context Trimmer & Prompt Deduplication
              </h2>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${tokenSaverEnabled ? "bg-success/15 text-success" : "bg-surface-3 text-text-muted"}`}>
                {tokenSaverEnabled ? "Active" : "Disabled"}
              </span>
            </div>
            <p className="text-sm text-text-muted mt-1">
              Safely evicts older conversation turns when context nears provider limits. Strictly preserves initial system prompt, recent 3 turns, and atomic tool call/result pairs.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Toggle checked={tokenSaverEnabled} onChange={() => handleTokenSaverToggle(!tokenSaverEnabled)} />
          </div>
        </div>

        {tokenSaverEnabled && (
          <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-sm font-medium">Token Budget Threshold</p>
                <p className="text-xs text-text-muted">Target maximum input tokens before sliding-window pruning initiates.</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={tokenSaverBudget}
                  onChange={(e) => setTokenSaverBudget(e.target.value)}
                  onBlur={handleTokenSaverBudgetBlur}
                  className="w-32 text-right font-mono text-sm"
                  min={1000}
                  step={1000}
                />
                <span className="text-xs text-text-muted">tokens</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Modal
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <span
              className={headroomRunning ? "text-success" : "text-warning"}
            >
              {headroomStatusLabel}
            </span>
          </div>
          {headroomRunning && (
            <a
              href="/api/headroom/proxy/dashboard"
              target="_blank"
              rel="noreferrer"
              className="w-full rounded border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
            >
              Open Headroom Dashboard
            </a>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Proxy URL</p>
              <button
                type="button"
                onClick={handleAutoDetectPort}
                disabled={autoDetectLoading}
                className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                title="Scan ports 8787-8791 for active Headroom instance"
              >
                <span className="material-symbols-outlined text-[14px]">radar</span>
                {autoDetectLoading ? "Scanning…" : "Auto-Detect Port"}
              </button>
            </div>
            <Input
              value={headroomUrl}
              onChange={(e) => setHeadroomUrl(e.target.value)}
              onBlur={handleHeadroomUrlBlur}
              placeholder="http://localhost:8787"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Use a local proxy for Start/Stop, or an external Docker sidecar
              like http://headroom:8787.
            </p>
          </div>

          {headroomStatus.python && (
            <div className="flex items-center justify-between text-xs px-3 py-2 rounded bg-surface-2 border border-border">
              <span className="text-text-muted">Python Environment:</span>
              <span className="font-mono text-text truncate max-w-[240px]" title={headroomStatus.python}>
                Python {headroomStatus.pythonVersion || "≥ 3.10"} ✓
              </span>
            </div>
          )}

          {headroomManaged ? (
            <Button
              onClick={handleHeadroomStop}
              variant="ghost"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
            </Button>
          ) : headroomRunning ? (
            <p className="text-sm text-success font-medium flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Headroom proxy is reachable and active.
            </p>
          ) : headroomCanStart ? (
            <Button
              onClick={handleHeadroomStart}
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Starting…" : "Start Headroom"}
            </Button>
          ) : !headroomLocalUrl ? (
            <p className="text-sm text-warning">
              Start Headroom separately at the configured URL, then recheck.
            </p>
          ) : !headroomStatus.python ? (
            <p className="text-sm text-warning">
              Python ≥ 3.10 required for local managed mode. Install Python
              first, or use an external proxy URL.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <Button
                onClick={handleAutoSetupHeadroom}
                fullWidth
                disabled={autoSetupLoading}
                className="font-semibold py-2.5"
              >
                {autoSetupLoading ? "Setting up Headroom…" : "⚡ 1-Click Auto Install & Start (Recommended)"}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Or install manually via terminal:</span>
              </div>
              <div className="flex items-center gap-2">
                <pre className="flex-1 rounded bg-black/5 dark:bg-white/5 p-2 text-xs font-mono overflow-x-auto">
                  {`pip install "headroom-ai[proxy]"`}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copy(`pip install "headroom-ai[proxy]"`)
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {(autoSetupLoading || installLog) && (
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-xs font-medium text-text-muted">Install Progress Log:</p>
              <pre className="p-2 rounded bg-black/10 dark:bg-black/40 text-[11px] font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                {installLog || autoSetupMessage || "Running pip install..."}
              </pre>
            </div>
          )}
          {headroomActionError && (
            <p className="text-sm text-warning">{headroomActionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshHeadroomStatus()}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button
              onClick={() => setShowHeadroomInstallModal(false)}
              fullWidth
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={false}
        title={pxpipeStatus.installed ? "PXPIPE" : "Setup PXPIPE"}
        onClose={() => setShowPxpipeModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Compress prompts using multimodal encoding. Runs in-process — no
            extra server or environment variables required.
          </p>
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <div className="flex items-center gap-2">
              <span className={pxpipeHealthy || pxpipeStatus.running ? "text-success" : "text-warning"}>
                {pxpipeStatusLabel}
                {pxpipeStatus.version ? ` · v${pxpipeStatus.version}` : ""}
              </span>
              {pxpipeStatus.installed && pxpipeUpdateInfo?.updateAvailable && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono font-medium">
                    Update: v{pxpipeUpdateInfo.latestVersion}
                  </span>
                  <button
                    type="button"
                    onClick={handlePxpipeUpdate}
                    disabled={pxpipeUpdating}
                    className="px-2 py-0.5 rounded text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {pxpipeUpdating ? "Updating…" : "Update"}
                  </button>
                </div>
              )}
            </div>
          </div>
          {pxpipeHealth?.checks?.length > 0 && (
            <div className="flex flex-col gap-1 rounded border border-border p-3">
              <p className="text-sm font-medium mb-1">Health check</p>
              {pxpipeHealth.checks.map((check) => (
                <div key={check.id} className="flex items-center justify-between text-xs">
                  <span className={check.ok ? "text-success" : "text-warning"}>
                    {check.ok ? "●" : "○"} {check.label}
                  </span>
                  {check.detail && (
                    <span className="text-text-muted font-mono truncate max-w-[50%]">{check.detail}</span>
                  )}
                </div>
              ))}
              {pxpipeHealth.error && (
                <p className="text-xs text-warning mt-1">{pxpipeHealth.error}</p>
              )}
            </div>
          )}
          {!pxpipeStatus.installed ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-warning">PXPIPE is not installed.</p>
              <Button
                onClick={() => pxpipeAction("install")}
                fullWidth
                disabled={pxpipeActionLoading || pxpipeStatus.installing}
              >
                {pxpipeActionLoading || pxpipeStatus.installing ? "Installing…" : "Install"}
              </Button>
              <p className="text-xs text-text-muted">
                Installs the npm package <code className="font-mono">pxpipe-proxy</code> into
                the 9Router data directory. May take a few minutes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {pxpipeStatus.running ? (
                <>
                  <Button onClick={() => pxpipeAction("restart")} variant="ghost" disabled={pxpipeActionLoading}>
                    Restart
                  </Button>
                  <Button onClick={() => pxpipeAction("stop")} variant="ghost" disabled={pxpipeActionLoading}>
                    Stop
                  </Button>
                </>
              ) : (
                <Button onClick={() => pxpipeAction("start")} disabled={pxpipeActionLoading}>
                  {pxpipeActionLoading ? "Starting…" : "Start"}
                </Button>
              )}
              <Button onClick={() => pxpipeAction("install")} variant="ghost" disabled={pxpipeActionLoading}>
                Repair
              </Button>
              <a
                href="/dashboard/pxpipe#logs"
                className="col-span-2 rounded border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
              >
                Open Logs
              </a>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Minimum prompt size (chars)</p>
            <Input
              value={String(pxpipeMinChars)}
              onChange={(e) => setPxpipeMinChars(e.target.value)}
              onBlur={handlePxpipeMinCharsBlur}
              placeholder="25000"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Requests smaller than this bypass PXPIPE and are sent as-is.
            </p>
          </div>
          {pxpipeActionError && (
            <p className="text-sm text-warning">{pxpipeActionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshPxpipeStatus().then(runPxpipeHealth)}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button onClick={() => setShowPxpipeModal(false)} fullWidth>
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!extrasConfirm}
        onClose={() => setExtrasConfirm(null)}
        onConfirm={() => {
          const fn = extrasConfirm?.onConfirm;
          setExtrasConfirm(null);
          fn?.();
        }}
        title={extrasConfirm?.title}
        message={extrasConfirm?.message}
        confirmText={extrasConfirm?.confirmText}
        variant={extrasConfirm?.variant}
      />
    </div>
  );
}

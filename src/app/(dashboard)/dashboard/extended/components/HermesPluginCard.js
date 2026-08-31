"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge, Input } from "@/shared/components";

export default function HermesPluginCard() {
  const [status, setStatus] = useState({
    installed: false,
    installing: false,
    version: null,
    path: null,
    running: false,
    pid: null,
    uptimeMs: 0,
  });
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logType, setLogType] = useState("service"); // 'service' | 'install'
  const [logsText, setLogsText] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  // Telegram settings state
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [telegramConfig, setTelegramConfig] = useState({
    botToken: "",
    allowedUsers: "",
    allowAllUsers: false,
    groupAllowedChats: "",
    homeChannel: "",
    homeChannelName: "",
    cronThreadId: "",
    webhookUrl: "",
    webhookPort: "",
    webhookSecret: "",
    enabled: false,
  });
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramSaving, setTelegramSaving] = useState(false);

  const fetchTelegramConfig = useCallback(async () => {
    setTelegramLoading(true);
    try {
      const res = await fetch("/api/plugins/hermes/telegram");
      if (res.ok) {
        const data = await res.json();
        setTelegramConfig(data);
      }
    } catch (e) {
      console.error("Failed to fetch Telegram config:", e);
    } finally {
      setTelegramLoading(false);
    }
  }, []);

  const saveTelegramSettings = async (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    setTelegramSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/plugins/hermes/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...telegramConfig, autoRestart: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTelegramConfig(data.config);
        setShowTelegramModal(false);
        setSuccessMsg(
          data.restarted
            ? "Telegram settings saved and Hermes gateway restarted successfully."
            : "Telegram settings saved."
        );
        fetchStatus();
      } else {
        setErrorMsg(data.error || data.warning || "Failed to save Telegram settings");
      }
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setTelegramSaving(false);
    }
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/hermes/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.error("Failed to fetch Hermes status:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [statusRes, tgRes] = await Promise.all([
          fetch("/api/plugins/hermes/status"),
          fetch("/api/plugins/hermes/telegram"),
        ]);
        if (statusRes.ok && mounted) {
          const data = await statusRes.json();
          setStatus(data);
        }
        if (tgRes.ok && mounted) {
          const tgData = await tgRes.json();
          setTelegramConfig(tgData);
        }
      } catch (e) {
        console.error("Failed to fetch Hermes status / config:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const timer = setInterval(() => {
      fetch("/api/plugins/hermes/status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && mounted) setStatus(data);
        })
        .catch(() => {});
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const handleInstall = async () => {
    const isWindows = typeof window !== "undefined" && window.navigator?.userAgent?.includes("Win");
    const cmdHint = isWindows
      ? "iex (irm https://hermes-agent.nousresearch.com/install.ps1)"
      : "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash";
    const confirmed = window.confirm(
      `Install official NousResearch Hermes Agent CLI using:\n\n${cmdHint}\n\nDo you wish to proceed?`
    );
    if (!confirmed) return;

    setActionInProgress(true);
    setErrorMsg(null);
    setLogType("install");
    setShowLogsModal(true);
    setLogsText("Initiating official Hermes Agent installation...\n");

    // Trigger install in background
    fetch("/api/plugins/hermes/install", { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus((prev) => ({ ...prev, ...data }));
        } else {
          setErrorMsg(data.error || "Installation failed. Check install log.");
        }
      })
      .catch((e) => {
        setErrorMsg(e.message);
      })
      .finally(() => {
        setActionInProgress(false);
      });

    // Start aggressive log polling while installing
    const pollLogs = setInterval(async () => {
      try {
        const [logsRes, statusRes] = await Promise.all([
          fetch("/api/plugins/hermes/logs?type=install&lines=200"),
          fetch("/api/plugins/hermes/status"),
        ]);
        if (logsRes.ok) {
          const lData = await logsRes.json();
          if (lData.logs) setLogsText(lData.logs);
        }
        if (statusRes.ok) {
          const sData = await statusRes.json();
          setStatus(sData);
          if (!sData.installing && sData.installed) {
            clearInterval(pollLogs);
          }
        }
      } catch { /* ignore poll errors */ }
    }, 1500);

    setTimeout(() => clearInterval(pollLogs), 310000);
  };

  const handleStart = async () => {
    setActionInProgress(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/plugins/hermes/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["gateway"] }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchStatus();
      } else {
        setErrorMsg(data.error || "Failed to start Hermes service");
      }
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleStop = async () => {
    setActionInProgress(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/plugins/hermes/stop", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        fetchStatus();
      } else {
        setErrorMsg(data.error || "Failed to stop Hermes service");
      }
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRestart = async () => {
    setActionInProgress(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/plugins/hermes/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["gateway"] }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchStatus();
      } else {
        setErrorMsg(data.error || "Failed to restart Hermes service");
      }
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setActionInProgress(false);
    }
  };

  const openLogs = async (type = "service") => {
    setLogType(type);
    setShowLogsModal(true);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/plugins/hermes/logs?type=${type}&lines=150`);
      if (res.ok) {
        const data = await res.json();
        setLogsText(data.logs || "No logs available.");
      }
    } catch (e) {
      setLogsText(`Failed to load logs: ${e.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const formatUptime = (ms) => {
    if (!ms || ms <= 0) return "0s";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    const hrs = Math.floor(min / 60);
    return `${hrs}h ${min % 60}m`;
  };

  return (
    <Card className="p-6 space-y-5 border-border bg-surface">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="material-symbols-outlined text-primary text-[22px]">smart_toy</span>
            <h2 className="text-base font-semibold text-text-main">Hermes Agent Service</h2>
            {status.installed ? (
              status.running ? (
                <Badge variant="success" size="sm">Running (PID {status.pid})</Badge>
              ) : (
                <Badge variant="secondary" size="sm">Stopped</Badge>
              )
            ) : status.installing || actionInProgress ? (
              <Badge variant="primary" size="sm" className="animate-pulse flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                <span>Installing...</span>
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">Not Installed</Badge>
            )}
            {status.version && (
              <span className="text-xs px-2 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
                v{status.version}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            Run NousResearch Hermes Agent as a managed local background process with automated lifecycle, PID tracking, and log output.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {status.installed ? (
            <>
              {status.running ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      fetchTelegramConfig();
                      setShowTelegramModal(true);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">send</span>
                    <span>Telegram</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestart}
                    disabled={actionInProgress}
                    className="flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                    <span>Restart</span>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleStop}
                    disabled={actionInProgress}
                    className="flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">stop</span>
                    <span>Stop</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      fetchTelegramConfig();
                      setShowTelegramModal(true);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">send</span>
                    <span>Telegram</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleStart}
                    disabled={actionInProgress}
                    className="flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                    <span>Start</span>
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => openLogs("service")}
                className="flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">description</span>
                <span>Logs</span>
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleInstall}
                disabled={actionInProgress || status.installing}
                className="flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {status.installing || actionInProgress ? "progress_activity" : "download"}
                </span>
                <span>{status.installing || actionInProgress ? "Installing..." : "Install Hermes Agent"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openLogs("install")}
                className="flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">description</span>
                <span>Install Logs</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="font-bold underline ml-2">Dismiss</button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="font-bold underline ml-2">Dismiss</button>
        </div>
      )}

      {status.installed && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-surface-2 border border-border/50">
            <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider block mb-1">Status</span>
            <span className="text-xs font-semibold text-text-main">
              {status.running ? "Active (Running)" : "Idle (Stopped)"}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-surface-2 border border-border/50">
            <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider block mb-1">Process PID</span>
            <span className="text-xs font-semibold text-text-main font-mono">
              {status.pid || "-"}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-surface-2 border border-border/50">
            <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider block mb-1">Uptime</span>
            <span className="text-xs font-semibold text-text-main">
              {status.running ? formatUptime(status.uptimeMs) : "-"}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-surface-2 border border-border/50">
            <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider block mb-1">Install Path</span>
            <span className="text-xs font-mono text-text-muted truncate block" title={status.path || ""}>
              {status.path || "Managed Path"}
            </span>
          </div>
        </div>
      )}

      {/* Telegram Gateway Settings Modal */}
      {showTelegramModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-xl rounded-2xl bg-surface border border-border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-2/40">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">send</span>
                <h3 className="text-sm font-semibold text-text-main">
                  Telegram Gateway Configuration
                </h3>
              </div>
              <button
                onClick={() => setShowTelegramModal(false)}
                className="p-1 rounded-md text-text-muted hover:text-text-main"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={saveTelegramSettings} className="p-5 overflow-y-auto space-y-4 flex-1">
              <div className="p-3.5 rounded-xl bg-surface-2/90 border border-border/60 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-text-main">
                  <span className="material-symbols-outlined text-[16px] text-primary">info</span>
                  <span>Required Manual Steps in Telegram</span>
                </div>
                <div className="space-y-1.5 text-text-muted text-[11.5px] leading-relaxed pl-1">
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-primary shrink-0">1.</span>
                    <span><strong>Create Bot & Copy Token:</strong> Chat with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono">@BotFather</a> &rarr; send <span className="font-mono bg-surface px-1 py-0.5 rounded text-primary">/newbot</span> &rarr; paste the API Token below.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-primary shrink-0">2.</span>
                    <span><strong>Disable Privacy Mode (Required for Groups):</strong> In <span className="font-mono text-primary">@BotFather</span> &rarr; send <span className="font-mono bg-surface px-1 py-0.5 rounded text-primary">/setprivacy</span> &rarr; select bot &rarr; choose <strong>Disable</strong> so Hermes can read group messages.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-primary shrink-0">3.</span>
                    <span><strong>Start Interaction:</strong> Open bot chat in Telegram &rarr; click <strong>Start</strong> (<span className="font-mono text-primary">/start</span>). Hermes is ready to chat via 9Router.</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-main flex items-center justify-between">
                  <span>Telegram Bot Token</span>
                  <span className="text-[10px] text-primary font-mono">TELEGRAM_BOT_TOKEN</span>
                </label>
                <Input
                  type="password"
                  value={telegramConfig.botToken || ""}
                  onChange={(e) => setTelegramConfig({ ...telegramConfig, botToken: e.target.value })}
                  placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  className="font-mono text-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-main flex items-center justify-between">
                  <span>Allowed User IDs (comma-separated)</span>
                  <span className="text-[10px] text-text-muted font-mono">TELEGRAM_ALLOWED_USERS</span>
                </label>
                <Input
                  type="text"
                  value={telegramConfig.allowedUsers || ""}
                  onChange={(e) => setTelegramConfig({ ...telegramConfig, allowedUsers: e.target.value })}
                  placeholder="123456789, 987654321"
                  className="font-mono text-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-main flex items-center justify-between">
                  <span>Allowed Group Chat IDs (comma-separated or *)</span>
                  <span className="text-[10px] text-text-muted font-mono">TELEGRAM_GROUP_ALLOWED_CHATS</span>
                </label>
                <Input
                  type="text"
                  value={telegramConfig.groupAllowedChats || ""}
                  onChange={(e) => setTelegramConfig({ ...telegramConfig, groupAllowedChats: e.target.value })}
                  placeholder="-1004474330101, *"
                  className="font-mono text-xs w-full"
                />
                <p className="text-[11px] text-text-muted">
                  Authorize entire Telegram groups / channels by chat ID, or <span className="font-mono text-primary">*</span> for any group.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-surface-2/60 border border-border/50 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(telegramConfig.allowAllUsers)}
                    onChange={(e) => setTelegramConfig({ ...telegramConfig, allowAllUsers: e.target.checked })}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <span className="text-xs font-medium text-text-main">
                    Allow all Telegram users (TELEGRAM_ALLOW_ALL_USERS=true)
                  </span>
                </label>
                <p className="text-[11px] text-text-muted pl-6">
                  Permit any user inside groups or DMs to interact with Hermes without explicit user ID allowlists.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-main block">Home Chat ID (Optional)</label>
                  <Input
                    type="text"
                    value={telegramConfig.homeChannel || ""}
                    onChange={(e) => setTelegramConfig({ ...telegramConfig, homeChannel: e.target.value })}
                    placeholder="-100123456789"
                    className="font-mono text-xs w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-main block">Home Chat Name (Optional)</label>
                  <Input
                    type="text"
                    value={telegramConfig.homeChannelName || ""}
                    onChange={(e) => setTelegramConfig({ ...telegramConfig, homeChannelName: e.target.value })}
                    placeholder="General / Cron"
                    className="text-xs w-full"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">
                  Saving automatically updates <span className="font-mono">~/.hermes/.env</span> and restarts gateway.
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTelegramModal(false)}
                    disabled={telegramSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={telegramSaving}
                    disabled={telegramLoading}
                    className="min-w-[120px] shrink-0"
                  >
                    Save & Apply
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-3xl rounded-2xl bg-surface border border-border shadow-xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">terminal</span>
                <h3 className="text-sm font-semibold text-text-main">
                  Hermes {logType === "install" ? "Install" : "Service"} Logs
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => openLogs(logType === "install" ? "service" : "install")}
                >
                  Switch to {logType === "install" ? "Service" : "Install"} Log
                </Button>
                <button
                  onClick={() => setShowLogsModal(false)}
                  className="p-1 rounded-md text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>
            <div className="p-4 flex-1 overflow-y-auto font-mono text-xs bg-black/80 text-emerald-400 select-text whitespace-pre-wrap">
              {logsLoading ? "Loading logs..." : logsText}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

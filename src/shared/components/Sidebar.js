"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import NineRemotePromoModal from "./NineRemotePromoModal";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/extended", label: "9Router Extended", icon: "auto_awesome" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAutoUpdating, setIsAutoUpdating] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartChoice, setAutoStartChoice] = useState(true);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [pkgManager, setPkgManager] = useState("npm");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [checkStatus, setCheckStatus] = useState(null);
  const { copied, copy } = useCopyToClipboard(2000);

  const getInstallCmd = (pm = pkgManager) => {
    if (updateInfo?.packageManagers?.[pm]) {
      return updateInfo.packageManagers[pm];
    }
    const tarball = updateInfo?.tarballUrl || UPDATER_CONFIG.tarballUrl;
    if (pm === "bun") return `bun add -g ${tarball}`;
    if (pm === "pnpm") return `pnpm add -g ${tarball}`;
    if (pm === "yarn") return `yarn global add ${tarball}`;
    return `npm i -g ${tarball} --force`;
  };

  const INSTALL_CMD = getInstallCmd(pkgManager);

  const handleSelectPkgManager = (pm) => {
    setPkgManager(pm);
    try {
      localStorage.setItem("preferred_pkg_manager", pm);
    } catch {}
  };

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // Check auto-start state on mount
  useEffect(() => {
    fetch("/api/autostart")
      .then(res => res.json())
      .then(data => {
        if (typeof data.enabled === "boolean") {
          setAutoStartEnabled(data.enabled);
          setAutoStartChoice(data.enabled);
        }
      })
      .catch(() => {});
  }, []);

  const checkForUpdates = async (force = false) => {
    setIsCheckingUpdate(true);
    setCheckStatus(null);
    try {
      const res = await fetch(`/api/version${force ? "?force=true" : ""}`);
      const data = await res.json();

      if (data.defaultPkgManager) {
        try {
          const saved = localStorage.getItem("preferred_pkg_manager");
          if (saved) setPkgManager(saved);
          else setPkgManager(data.defaultPkgManager);
        } catch {
          setPkgManager(data.defaultPkgManager);
        }
      }

      if (data.hasUpdate) {
        setUpdateInfo(data);
        if (force) setShowUpdateModal(true);
      } else {
        setUpdateInfo(null);
        if (force) {
          setCheckStatus("✓ Up to date");
          setTimeout(() => setCheckStatus(null), 3500);
        }
      }
    } catch {
      if (force) {
        setCheckStatus("Check failed");
        setTimeout(() => setCheckStatus(null), 3500);
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // Check version on mount
  useEffect(() => {
    checkForUpdates(false);
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  const handleAutoUpdate = async () => {
    setIsAutoUpdating(true);
    const cmd = getInstallCmd(pkgManager);
    try {
      const res = await fetch("/api/version/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installCmd: cmd,
          autoStart: autoStartChoice,
          packageManager: pkgManager,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsDisconnected(true);
      } else {
        alert(data.message || "Failed to trigger automatic updater");
        setIsAutoUpdating(false);
      }
    } catch {
      setIsDisconnected(true);
    }
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(INSTALL_CMD); } catch { /* clipboard blocked */ }
    copy(INSTALL_CMD);
    try {
      await fetch("/api/autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: autoStartChoice }),
      });
    } catch {}
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>

        {/* Logo & Version */}
        <div className="px-6 py-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Link href="/dashboard" className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)] shrink-0">
                <span className="material-symbols-outlined text-white text-[20px]">hub</span>
              </div>
              <div className="flex flex-col min-w-0">
                <h1 className="text-lg font-semibold tracking-tight text-text-main truncate">
                  {APP_CONFIG.name}
                </h1>
                <span className="text-xs text-text-muted whitespace-nowrap">
                  v{APP_CONFIG.version}
                </span>
              </div>
            </Link>

            {/* Sleek icon button for Check Update */}
            <button
              type="button"
              onClick={() => checkForUpdates(true)}
              disabled={isCheckingUpdate}
              title={checkStatus || "Check for updates"}
              className="size-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-main hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50 shrink-0"
            >
              <span className={cn("material-symbols-outlined text-[16px]", isCheckingUpdate && "animate-spin text-primary")}>
                {checkStatus === "✓ Up to date" ? "check_circle" : "sync"}
              </span>
            </button>
          </div>

          {checkStatus && (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium px-0.5">
              {checkStatus}
            </div>
          )}

          {updateInfo && (
            <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">
                  ↑ {updateInfo.isRebuild
                    ? `New build (v${updateInfo.latestVersion || APP_CONFIG.version})`
                    : `Update v${updateInfo.latestVersion}`}
                </span>
                <div className="flex items-center gap-0.5 bg-surface-2 p-0.5 rounded-md">
                  {["bun", "npm", "pnpm", "yarn"].map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => handleSelectPkgManager(pm)}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase transition-all cursor-pointer",
                        pkgManager === pm
                          ? "bg-primary text-white shadow-xs"
                          : "text-text-muted hover:text-text-main"
                      )}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                >
                  Install update
                </button>
                <button
                  type="button"
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer text-left"
                >
                  <code className="block text-[10px] text-text-muted font-mono truncate">
                    {copied ? "✓ Copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                isActive(item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                {item.icon}
              </span>
              <span className="text-[13px] font-medium">{item.label}</span>
            </Link>
          ))}

          {/* System section */}
          <div className="pt-3 mt-2 space-y-0.5">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              System
            </p>

            {/* Media Providers accordion */}
            <button
              onClick={() => setMediaOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                pathname.startsWith("/dashboard/media-providers")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px]">perm_media</span>
              <span className="text-[13px] font-medium flex-1 text-left">Media Providers</span>
              <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div className="pl-4">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                      pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                        ? "bg-primary/10 text-primary"
                        : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-[16px]">{kind.icon}</span>
                    <span className="text-sm">{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                    pathname.startsWith(COMBINED_WEB_ITEM.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
                  <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                  isActive(item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                <span
                  className={cn(
                    "material-symbols-outlined text-[18px]",
                    isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                  )}
                >
                  {item.icon}
                </span>
                <span className="text-[13px] font-medium">{item.label}</span>
              </Link>
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined text-[18px]",
                      isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Remote */}
            <button
              onClick={() => setShowRemoteModal(true)}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group w-full",
                "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">
                computer
              </span>
              <span className="text-[13px] font-medium">9Remote</span>
            </button>

            {/* 9English */}
            <a
              href="https://9english.net/"
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group w-full",
                "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">
                translate
              </span>
              <span className="text-[13px] font-medium">9English</span>
            </a>

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                isActive("/dashboard/profile")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive("/dashboard/profile") ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                settings
              </span>
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </div>
        </nav>

      </aside>

      {/* Remote Promo Modal */}
      <NineRemotePromoModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleAutoUpdate}
        title="Update 9Router Extended"
        message={
          <div className="space-y-3.5">
            <p className="text-sm text-text-main">
              {updateInfo?.isRebuild
                ? `New build detected with updated changes (v${updateInfo?.latestVersion || APP_CONFIG.version}). Click Install Update to automatically update and relaunch.`
                : `Upgrade to v${updateInfo?.latestVersion || ""}? Click Install Update to automatically update and relaunch.`}
            </p>

            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1.5">Package Manager:</label>
              <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-lg">
                {["bun", "npm", "pnpm", "yarn"].map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => handleSelectPkgManager(pm)}
                    className={cn(
                      "flex-1 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer text-center",
                      pkgManager === pm
                        ? "bg-primary text-white shadow-sm"
                        : "text-text-muted hover:text-text-main hover:bg-surface-3"
                    )}
                  >
                    {pm}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">Command preview:</label>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-2 border border-border-subtle">
                <code className="text-xs font-mono text-primary flex-1 break-all select-all">
                  {INSTALL_CMD}
                </code>
                <button
                  type="button"
                  onClick={() => copy(INSTALL_CMD)}
                  className="px-2 py-1 rounded bg-surface-3 hover:bg-surface-1 text-xs text-text-main font-medium cursor-pointer"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-text-muted bg-surface-2 p-2 rounded cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoStartChoice}
                onChange={(e) => setAutoStartChoice(e.target.checked)}
                className="rounded border-border-subtle text-primary focus:ring-primary"
              />
              <span>Enable auto startup on system boot (Run silently on background)</span>
            </label>
          </div>
        }
        confirmText={isAutoUpdating ? "Updating..." : "Install Update"}
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              pkgManager={pkgManager}
              onSelectPkgManager={handleSelectPkgManager}
              autoStartChoice={autoStartChoice}
              setAutoStartChoice={setAutoStartChoice}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              onAutoUpdate={handleAutoUpdate}
              isAutoUpdating={isAutoUpdating}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-primary/20 text-primary mx-auto mb-4">
                <span className="material-symbols-outlined text-[32px] animate-spin">sync</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">9Router Updating...</h2>
              <p className="text-text-muted mb-6">Updating 9Router Extended in background. Server will relaunch shortly.</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

function ManualUpdatePanel({ latestVersion, installCmd, copied, pkgManager, onSelectPkgManager, autoStartChoice, setAutoStartChoice, onCopyAndShutdown, onCancel, onAutoUpdate, isAutoUpdating, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">system_update</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update 9Router Extended{latestVersion ? ` (v${latestVersion})` : ""}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Update in progress or server stopped."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Perform 1-click update or copy command for manual installation."}
          </p>
        </div>
      </div>

      {onSelectPkgManager && (
        <div className="mb-3">
          <label className="block text-xs font-semibold text-white/70 mb-1.5">Package Manager:</label>
          <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded-lg">
            {["bun", "npm", "pnpm", "yarn"].map((pm) => (
              <button
                key={pm}
                type="button"
                onClick={() => onSelectPkgManager(pm)}
                disabled={isCountingDown || isAutoUpdating}
                className={cn(
                  "flex-1 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer text-center",
                  pkgManager === pm
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                )}
              >
                {pm}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      {setAutoStartChoice && (
        <label className="flex items-center gap-2 text-xs text-white/70 bg-white/5 p-2 rounded mb-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoStartChoice}
            onChange={(e) => setAutoStartChoice(e.target.checked)}
            disabled={isCountingDown || isAutoUpdating}
            className="rounded border-white/20 text-primary focus:ring-primary"
          />
          <span>Enable auto startup on system boot (No PM2 needed)</span>
        </label>
      )}

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={isCountingDown || isAutoUpdating}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={onCopyAndShutdown} disabled={isCountingDown || isAutoUpdating}>
              {copied ? "✓ Copied" : "Copy & Shutdown"}
            </Button>
            <Button variant="primary" fullWidth onClick={onAutoUpdate} disabled={isCountingDown || isAutoUpdating}>
              {isAutoUpdating ? "Updating..." : `Install with ${pkgManager || "npm"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  pkgManager: PropTypes.string,
  onSelectPkgManager: PropTypes.func,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};

"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl, Card } from "@/shared/components";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const TABS = [
  { value: "overview", label: "Overview", icon: "dashboard" },
  { value: "details", label: "Detailed Analysis", icon: "analytics" },
  { value: "logs", label: "Request Logs", icon: "list_alt" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState(searchParams.get("period") || "24h");
  const [liveStats, setLiveStats] = useState({ totalRequests: 0, activeProviders: 0, avgLatency: 0 });
  
  // Live stats from health stream
  useEffect(() => {
    let eventSource;
    
    const connect = () => {
      try {
        eventSource = new EventSource("/api/health/latency-stream");
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data?.providers) {
              const providers = Object.values(data.providers);
              const activeCount = providers.filter((p) => (p.circuitState || "closed").toLowerCase() === "closed").length;
              const measured = providers.filter((p) => Number.isFinite(p.emaLatency));
              const avgLat = measured.length > 0
                ? Math.round(measured.reduce((sum, p) => sum + p.emaLatency, 0) / measured.length)
                : 0;

              setLiveStats({
                totalRequests: providers.reduce((sum, p) => sum + (p.successCount || 0) + (p.failCount || 0), 0),
                activeProviders: activeCount,
                avgLatency: avgLat,
              });
            }
          } catch (err) {
            console.warn("Failed to parse live stats:", err);
          }
        };
      } catch (err) {
        console.error("Failed to connect live stats:", err);
      }
    };
    
    connect();
    
    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };
  
  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    const params = new URLSearchParams(searchParams);
    params.set("period", newPeriod);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Page Header with Live Stats */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        {/* Live Stats Pills */}
        <div className="flex flex-wrap gap-2">
          <div className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-base">bolt</span>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-semibold text-primary/70 tracking-wider">Live Requests</span>
              <span className="text-lg font-bold text-primary tabular-nums">{liveStats.totalRequests.toLocaleString()}</span>
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-success/10 border border-success/30 flex items-center gap-2">
            <span className="material-symbols-outlined text-success text-base">check_circle</span>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-semibold text-success/70 tracking-wider">Active</span>
              <span className="text-lg font-bold text-success tabular-nums">{liveStats.activeProviders}</span>
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 flex items-center gap-2">
            <span className="material-symbols-outlined text-warning text-base">speed</span>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-semibold text-warning/70 tracking-wider">Avg Response Time</span>
              <span className="text-lg font-bold text-warning tabular-nums">{liveStats.avgLatency}ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Period Selector */}
      <Card padding="sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">calendar_month</span>
            Time Period:
          </span>
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={handlePeriodChange}
            size="sm"
          />
        </div>
      </Card>

      {/* Tab Navigation */}
      <div className="border-b border-border -mx-1 sm:mx-0">
        <nav className="flex gap-1 px-1 sm:px-0" aria-label="Analytics tabs">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => handleTabChange(t.value)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === t.value
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-text-muted hover:text-text-main hover:border-border hover:bg-surface-1/50"
              }`}
            >
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "overview" && (
          <Suspense fallback={<CardSkeleton />}>
            <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
          </Suspense>
        )}
        {activeTab === "details" && (
          <Suspense fallback={<CardSkeleton />}>
            <RequestDetailsTab period={period} />
          </Suspense>
        )}
        {activeTab === "logs" && <RequestLogger />}
      </div>
    </div>
  );
}

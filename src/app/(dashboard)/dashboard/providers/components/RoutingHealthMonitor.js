"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, Badge } from "@/shared/components";

export default function RoutingHealthMonitor() {
  const [healthData, setHealthData] = useState({});
  const [connected, setConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [sortBy, setSortBy] = useState("name"); // name, latency, success
  const [filterState, setFilterState] = useState("all"); // all, open, closed, half-open
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let eventSource;
    let reconnectTimer;
    
    const connect = () => {
      try {
        eventSource = new EventSource("/api/health/latency-stream");
        
        eventSource.onopen = () => {
          setConnected(true);
          console.log("✓ Live health monitor connected");
        };
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.providers) {
              setHealthData(data.providers);
            }
          } catch (err) {
            console.warn("Failed to parse health data:", err);
          }
        };
        
        eventSource.onerror = () => {
          setConnected(false);
          eventSource?.close();
          // Auto-reconnect after 5 seconds
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch (err) {
        setConnected(false);
        console.error("Failed to connect health monitor:", err);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const providerKeys = Object.keys(healthData);
  
  // Filter and sort providers
  const filteredAndSortedProviders = useMemo(() => {
    let filtered = providerKeys.filter((key) => {
      const stat = healthData[key] || {};
      const circuit = stat.circuitState || "CLOSED";
      
      // Apply search filter
      if (searchTerm && !key.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      
      // Apply state filter
      if (filterState !== "all") {
        const stateMatch = circuit.toLowerCase() === filterState.toLowerCase() ||
          (filterState === "half-open" && circuit === "HALF_OPEN");
        if (!stateMatch) return false;
      }
      
      return true;
    });
    
    // Sort providers
    filtered.sort((a, b) => {
      const statA = healthData[a] || {};
      const statB = healthData[b] || {};
      
      switch (sortBy) {
        case "latency": {
          const latA = statA.emaLatency ?? statA.p50 ?? 0;
          const latB = statB.emaLatency ?? statB.p50 ?? 0;
          return latA - latB;
        }
        case "success":
          return (statB.successRate || 0) - (statA.successRate || 0);
        case "name":
        default:
          return a.localeCompare(b);
      }
    });
    
    return filtered;
  }, [healthData, providerKeys, sortBy, filterState, searchTerm]);

  const stats = useMemo(() => {
    const total = providerKeys.length;
    const closed = providerKeys.filter(k => (healthData[k]?.circuitState || "CLOSED").toUpperCase() === "CLOSED").length;
    const open = providerKeys.filter(k => (healthData[k]?.circuitState || "CLOSED").toUpperCase() === "OPEN").length;
    const halfOpen = providerKeys.filter(k => (healthData[k]?.circuitState || "CLOSED").toUpperCase() === "HALF_OPEN" || (healthData[k]?.circuitState || "CLOSED").toUpperCase() === "HALF-OPEN").length;
    const avgLatency = total > 0 
      ? Math.round(providerKeys.reduce((sum, k) => sum + (healthData[k]?.emaLatency ?? healthData[k]?.p50 ?? 0), 0) / total)
      : 0;
    
    return { total, closed, open, halfOpen, avgLatency };
  }, [healthData, providerKeys]);

  if (providerKeys.length === 0 && !connected) {
    return null;
  }

  return (
    <Card className="border-border/80 bg-surface-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-primary text-xl">speed</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-main">Live Routing Health & Speed Monitor</h3>
              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${connected ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success animate-pulse" : "bg-warning"}`} />
                {connected ? "Live Stream" : "Reconnecting..."}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Real-time latency tracking, success rates, and circuit breaker protection. {providerKeys.length > 0 && `Monitoring ${stats.total} provider${stats.total !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-text-muted hover:text-text-main p-1 rounded-md transition-colors"
          title={isExpanded ? "Collapse" : "Expand"}
        >
          <span className="material-symbols-outlined text-base">
            {isExpanded ? "expand_less" : "expand_more"}
          </span>
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-3 border-t border-border space-y-3">
          {/* Summary Stats */}
          {providerKeys.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="px-3 py-2 rounded-lg bg-surface-2 border border-border">
                <p className="text-[10px] uppercase font-semibold tracking-wider text-text-muted mb-0.5">Total</p>
                <p className="text-lg font-bold text-text-main">{stats.total}</p>
              </div>
              <div className="px-3 py-2 rounded-lg bg-success/10 border border-success/30">
                <p className="text-[10px] uppercase font-semibold tracking-wider text-success/80 mb-0.5">Healthy</p>
                <p className="text-lg font-bold text-success">{stats.closed}</p>
              </div>
              <div className="px-3 py-2 rounded-lg bg-error/10 border border-error/30">
                <p className="text-[10px] uppercase font-semibold tracking-wider text-error/80 mb-0.5">Tripped</p>
                <p className="text-lg font-bold text-error">{stats.open}</p>
              </div>
              <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/30">
                <p className="text-[10px] uppercase font-semibold tracking-wider text-warning/80 mb-0.5">Recovering</p>
                <p className="text-lg font-bold text-warning">{stats.halfOpen}</p>
              </div>
              <div className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30">
                <p className="text-[10px] uppercase font-semibold tracking-wider text-primary/80 mb-0.5">Avg Response Time</p>
                <p className="text-lg font-bold text-primary">{stats.avgLatency}ms</p>
              </div>
            </div>
          )}

          {/* Filters and Sort */}
          {providerKeys.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search providers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-md bg-surface-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-md bg-surface-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="all">All States</option>
                  <option value="closed">✓ Healthy</option>
                  <option value="open">⚠ Tripped</option>
                  <option value="half-open">⟳ Recovering</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-md bg-surface-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="name">Sort: Name</option>
                  <option value="latency">Sort: Response Time (Fastest) ↑</option>
                  <option value="success">Sort: Success ↓</option>
                </select>
              </div>
            </div>
          )}

          {/* Provider Grid */}
          {filteredAndSortedProviders.length === 0 ? (
            <div className="py-8 text-center">
              <span className="material-symbols-outlined text-4xl text-text-muted/30 mb-2">monitoring</span>
              <p className="text-sm text-text-muted">
                {providerKeys.length === 0
                  ? "No live traffic yet. Send requests to see real-time metrics."
                  : searchTerm || filterState !== "all"
                  ? "No providers match your filters."
                  : "Waiting for health data..."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredAndSortedProviders.map((pKey) => {
                const stat = healthData[pKey] || {};
                const circuit = stat.circuitState || "CLOSED";
                const isClosed = circuit === "CLOSED";
                const isOpen = circuit === "OPEN";
                const isHalfOpen = circuit === "HALF_OPEN";

                return (
                  <div
                    key={pKey}
                    className={`p-2.5 rounded-lg border flex flex-col justify-between gap-2 transition-all ${
                      isClosed
                        ? "border-success/30 bg-success/5"
                        : isOpen
                        ? "border-error/30 bg-error/5"
                        : "border-warning/30 bg-warning/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold font-mono truncate text-text-main" title={pKey}>
                        {pKey}
                      </span>
                      <Badge
                        variant={isClosed ? "success" : isOpen ? "error" : "warning"}
                        size="sm"
                      >
                        {isHalfOpen ? "HALF-OPEN" : circuit}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[11px] text-text-muted">
                      <div>
                        <span className="block text-[10px] uppercase font-semibold tracking-wider opacity-70">Speed</span>
                        <span className="font-mono text-text-main font-medium">{Math.round(stat.emaLatency ?? stat.p50 ?? 0)}ms</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase font-semibold tracking-wider opacity-70">Failures</span>
                        <span className="font-mono text-text-main font-medium">{stat.consecutiveFails ?? 0}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase font-semibold tracking-wider opacity-70">Success</span>
                        <span className={`font-mono font-medium ${
                          (stat.successRate ?? 1) >= 0.95 ? "text-success" :
                          (stat.successRate ?? 1) >= 0.8 ? "text-warning" :
                          "text-error"
                        }`}>
                          {Math.round((stat.successRate ?? 1) * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
